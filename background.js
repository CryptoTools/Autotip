var cents_per_btc, btc_price_fetch_date;
function get_price_from_winkdex() {
    // Makes a call to the winkdex to get the current price for bitcoin
    // only one call is made every three hours. the value is cached in chrome's
    // local storage.

    var age_hours;
    if(cents_per_btc) {
        var age_hours = (new Date() - btc_price_fetch_date) / 3600000; // 3 hours in miliseconds
    }

    if(!age_hours || age_hours > 3) {
        $.ajax({
            url: "https://winkdex.com/api/v0/price",
            type: 'get',
            async: false,
            success: function(response) {
                cents_per_btc = response['price'];
            }
        });
        btc_price_fetch_date = new Date();
        console.log("Made call to winkdex:", cents_per_btc / 100, "USD/BTC");
    } else {
        console.log("Using old value for bitcoin price:", cents_per_btc / 100, "USD/BTC from", btc_price_fetch_date);
    }
    return cents_per_btc;
}

function reset_interval() {
    // for testing and debugging
    chrome.storage.sync.set({
        usd_tipped_so_far_today: 0,
        daily_limit_start: new Date().getTime(),
        all_tipped_addresses_today: []
    });
}

function send_tips(tips, autotip, responseFunction) {
    // Make the bitcoin transaction and push it to the network.
    // * The first argument is a list of addresses and the corresponding ratio
    // * The second argument is a boolean determining if this tip is being sent
    // via manual or automatically.
    // * The third argument is a function that corresponds to chrome's message system
    // that returns the status of this tip to the popup.

    chrome.storage.sync.get({
        daily_limit_start: 'none',
        usd_tipped_so_far_today: 0,
        daily_tip_limit: 0.5,
        pub_key: 'none',
        priv_key: 'none',
        dollar_tip_amount: 0.05,
        all_tipped_addresses_today: [],
        beep_on_tip: true,
        one_per_address: true
    }, function(items) {
        var pub_key = items.pub_key;
        var priv_key = items.priv_key;
        var dollar_tip_amount = items.dollar_tip_amount;
        var usd_tipped_so_far_today = items.usd_tipped_so_far_today;
        var daily_limit_start = items.daily_limit_start;
        var daily_tip_limit = items.daily_tip_limit;
        var all_tipped_addresses_today = items.all_tipped_addresses_today;

        var now_timestamp = new Date().getTime();
        var day_ago_timestamp = now_timestamp - (60 * 60 * 24);

        /////////////////////////////////////////////////////
        ///// determine if we make the tip, or cancel the tip
        /////////////////////////////////////////////////////

        var new_accumulation = 0;

        if(daily_limit_start == 'none' || daily_limit_start < day_ago_timestamp) {
            // it was over a day ago since we've been keeping track, reset the interval
            console.log("Resetting interval now. Old interval started:", new Date(daily_limit_start))
            chrome.storage.sync.set({
                usd_tipped_so_far_today: 0,
                daily_limit_start: now_timestamp,
                all_tipped_addresses_today: []
            });
            daily_limit_start = now_timestamp;
            usd_tipped_so_far_today = 0;
            all_tipped_addresses_today = [];
        } else {
            // Make sure this tip isn't going to put us over the daily tipping limit
            new_accumulation = Number(dollar_tip_amount) + Number(usd_tipped_so_far_today);
            if(new_accumulation > daily_tip_limit && autotip) {
                console.log("Canceling tip! Over daily limit for autotip:", usd_tipped_so_far_today);
                return
            }
        }

        console.log("Interval start:", new Date(daily_limit_start));
        console.log("All addresses today:", all_tipped_addresses_today)

        /////////////////////////////////////////////////////
        // the tip is happening, create the transaction below
        /////////////////////////////////////////////////////

        chrome.runtime.sendMessage({popup_status: "Creating Transaction..."});

        var cents_per_btc = get_price_from_winkdex();
        var btc_amount = dollar_tip_amount / cents_per_btc * 100;
        var satoshi_amount = btc_amount * 100000000;

        console.log("This page will get:", Math.floor(satoshi_amount), "satoshis (", btc_amount.toFixed(8), "BTC)");

        var all_utxos = unspent_outputs_insight(pub_key);
        var utxos = [];
        var total_amount = 0;
        $.each(all_utxos, function(index, utxo) {
            // loop through each unspent output until we get enough to cover the cost of this tip.
            if(total_amount < satoshi_amount) {
                utxos.push(new Transaction.UnspentOutput(utxo));
                total_amount += utxo['amount'];
            }
        });

        if(total_amount < btc_amount) {
            console.log("Canceling tip because not enough unspent outputs. Deposit more bitcoin.");
            console.log("Needed: ", btc_amount, "you only have:", total_amount);
            return
        }

        normalize_ratios(tips);

        var total_tip_amount_satoshi = 0;
        var num_of_shapeshifts = 0; // counter to keep track of a bug in shapeshift.io's code
        var added_to_tx = [];
        var tx = new Transaction().from(utxos).change(pub_key);
        $.each(tips, function(index, tip) {
            if(autotip && one_per_address && all_tipped_addresses_today.indexOf(tip.address) >= 0) {
                console.log("Already tipped this address today:", all_tipped_addresses_today);
                return
            }

            var this_tip_amount = Math.floor(satoshi_amount * tip.ratio);

            var currency = clean_currency(tip.currency);
            if(currency == 'btc') {
                tx = tx.to(Address.fromString(tip.address), this_tip_amount);
                added_to_tx.push(tip.address);
                console.log('Added', tip.address, "to transaction at", this_tip_amount);
            } else if(currency) {
                // call shapeshift.io to convert the bitcoin tip to altcoin
                if(num_of_shapeshifts >= 1) {
                    console.log("Canceling recipient because Shapeshift.io's code has a bug that doesn't allow for multiple deposits for a single transactions")
                    return
                }
                var ssio_address = get_shift_address(pub_key, tip.address, currency);
                tx = tx.to(Address.fromString(ssio_address), this_tip_amount);
                added_to_tx.push(tip.address);
                console.log('Added', ssio_address, "to transaction at", this_tip_amount, "(shapeshift)");
                num_of_shapeshifts += 1;
            } else {
                console.log("Unknown currency (not supported by shapeshift.io)", tip.currency);
                return
            }

            total_tip_amount_satoshi += this_tip_amount;
        });

        if(added_to_tx.length == 0) {
            console.log("Skipping as there are no recipients");
            return
        }

        var satoshi_fee = Math.floor(0.01 / cents_per_btc * 1e10); // one cent fee
        var tx_hex = tx.fee(satoshi_fee).sign(priv_key).serialize();

        console.log("Using fee of", satoshi_fee, "Satoshis");
        console.log("Pushing tx:", tx_hex);

        $.post("https://btc.blockr.io/api/v1/tx/push", {hex: tx_hex}, function(response) {
            var total_tip_amount_dollar = total_tip_amount_satoshi * cents_per_btc / 1e10;
            var new_dollar_tip_amount_today = total_tip_amount_dollar + usd_tipped_so_far_today;

            console.log("Pushed transaction successfully. Tipped so far today: $", new_dollar_tip_amount_today.toFixed(2));

            $.each(added_to_tx, function(index, address) {
                // mark each address as having been sent to for today
                all_tipped_addresses_today.push(address);
            });
            chrome.storage.sync.set({
                usd_tipped_so_far_today: new_dollar_tip_amount_today,
                all_tipped_addresses_today: all_tipped_addresses_today
            });

            if(items.beep_on_tip) {
                var audio = new Audio(chrome.extension.getURL("beep.wav"));
                audio.play();
            }

            chrome.runtime.sendMessage({popup_status: "Tip Sent!"});
        });
    });
}


function set_icon(tab_id) {
    chrome.pageAction.show(tab_id);
    chrome.pageAction.setIcon({
        tabId: tab_id,
        path: chrome.extension.getURL('autotip-logo-38.png')
    });
}

var tip_addresses = [];
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // dispatches all messages

    if(request.get_btc_price) {
        sendResponse({price: get_price_from_winkdex()});
        return
    }

    if(request.get_tips) {
        // the popup's js needs the tips for displaying on that page.
        sendResponse({tips: tip_addresses[request.tab]});
        return
    }

    if(request.found_tips) {
        // report list of tips found on the page.

        var tab_id = sender.tab.id;
        set_icon(tab_id);
        tip_addresses[tab_id] = request.found_tips;
    }

    if(request.perform_tip == 'manual') {
        // user clicked the "tip now" button
        send_tips(request.tips, false, sendResponse);
        return
    }

    if(request.perform_tip == 'auto') {
        // autotip is enabled and we found some tips.
        send_tips(request.tips, true, sendResponse);
        return
    }
});
