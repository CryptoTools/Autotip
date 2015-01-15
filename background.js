function send_tip(currency, address, autotip) {
    // fixme: get the real tip address from the page
    var tip_address = Address.fromString('1HWpyFJ7N6rvFkq3ZCMiFnqM6hviNFmG5X');
    chrome.storage.sync.get({
        daily_limit_start: 'none',
        usd_tipped_so_far_today: 0,
        daily_tip_limit: 0.5,
        pub_key: 'none',
        priv_key: 'none',
        dollar_tip_amount: 0.05,
        all_tipped_addresses_today: []
    }, function(items) {
        var pub_key = items.pub_key;
        var priv_key = items.priv_key;
        var dollar_tip_amount = items.dollar_tip_amount;
        var usd_tipped_so_far_today = items.usd_tipped_so_far_today;
        var daily_limit_start = items.daily_limit_start;
        var daily_tip_limit = items.daily_tip_limit;
        var all_tipped_addresses_today = items.all_tipped_addresses_today;

        var now_timestamp = new Date().getTime() / 1000;
        var day_ago_timestamp = now_timestamp - (60 * 60 * 24);

        /////////////////////////////////////////////////////
        ///// determine if we make the tip, or cancel the tip
        /////////////////////////////////////////////////////

        var cancel_tip = false;
        var cancel_reason = '';

        if(daily_limit_start == 'none' || daily_limit_start < day_ago_timestamp) {
            // it was over a day ago since we've been keeping track, reset the interval
            chrome.storage.sync.set({
                usd_tipped_so_far_today: 0,
                daily_limit_start: now_timestamp,
                all_tipped_addresses_today: []
            });
        } else {
            var new_accumulation = Number(dollar_tip_amount) + Number(usd_tipped_so_far_today);
            if(new_accumulation <= daily_tip_limit) {
                // not over the limit
            } else if (autotip) {
                // over the limit, do not tip
                cancel_tip = true;
                cancel_reason = "Over daily limit: " + usd_tipped_so_far_today + " since " + new Date(daily_limit_start * 1000);
            } else {
                // we are over the limit, but its a manual tip, so we let it through
            }
        }

        if(all_tipped_addresses_today.indexOf(address) >= 0) {
            cancel_tip = true;
            cancel_reason = "Already tipped this address today " + all_tipped_addresses_today
        }

        if(cancel_tip) {
            console.log("Cancelled tip: ", cancel_reason);
            return
        }

        /////////////////////////////////////////////////////
        // the tip is happening, create the transaction below
        /////////////////////////////////////////////////////

        if(currency != 'btc') {
            // call shapeshift.io if needed to get a conversion address
        }

        $.get("https://winkdex.com/api/v0/price", function(response) {
            var cents_per_btc = response['price'];
            var btc_amount = dollar_tip_amount / cents_per_btc * 100;
            var satoshi_amount = btc_amount * 100000000;

            console.log('called winkdex: ', cents_per_btc / 100);

            $.get("http://btc.blockr.io/api/v1/address/unspent/" + pub_key, function(response) {
                console.log('called blockrio: ', response['data']['unspent'].length, " inputs");
                var utxos_from_blockrio = response['data']['unspent'];
                var utxos = [];
                var total_amount = 0;

                $.each(utxos_from_blockrio, function(index, utxo) {
                    // loop through each unspent output until we get enough to cover the cost of this tip.
                    if(total_amount < satoshi_amount) {
                        utxos.push(
                            new Transaction.UnspentOutput({
                                "txid": utxo['tx'],
                                "vout": utxo['n'],
                                "address": pub_key,
                                "scriptPubKey": utxo['script'],
                                "amount":  utxo['amount']
                            })
                        );
                        total_amount += utxo['amount'];
                    } else {
                        return false;
                    }
                });

                if(total_amount < satoshi_amount) {
                    console.log("Canceling tip because not enough unspent outputs. Deposit more bitcoin.");
                    return
                }

                var tx = new Transaction()
                    .to(tip_address, satoshi_amount)
                    .from(utxos)
                    .change(pub_key)
                    .sign(priv_key);

                $.post("http://btc.blockr.io/api/v1/tx/push", {hex: tx.serialize()}, function(response) {
                    console.log("Pushed transaction successfully. Tipped so far today:", new_accumulation);
                    all_tipped_addresses_today.push(address);
                    chrome.storage.sync.set({
                        usd_tipped_so_far_today: new_accumulation,
                        all_tipped_addresses_today: all_tipped_addresses_today
                    });
                });
            });
        });
    });
}

function get_icon_for_currency(currency) {
    var ll = currency.toLowerCase();
    if(ll == 'btc' || ll == 'bitcoin') {
        return chrome.extension.getURL('orange-bitcoin-38.png');
    }
    if(ll == 'ltc' || ll == 'litecoin') {
        return chrome.extension.getURL('litecoin-128.png');
    }
    if(ll == 'doge' || ll == 'dogecoin') {
        return chrome.extension.getURL('dogecoin-128.png');
    }
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // Called whe the user
    // clicks the tip now button on the page action popup.

    if(request.perform_tip) {
        // user clicked the "tip now" button
        send_tip(request.currency, request.address, false);
        return
    }
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    // when microtip meta tags gets found.

    // show the icon to the right currency
    var tab_id = sender.tab.id;
    chrome.pageAction.show(tab_id);

    chrome.pageAction.setIcon({
        tabId: tab_id,
        path: get_icon_for_currency(request.currency)
    });

    chrome.storage.sync.get({
        when_to_send:'ask',
    }, function(items) {
        if(items.when_to_send == '5min') {
            // TODO
        } else if (items.when_to_send == 'immediately') {
            send_tip(currency, request.address, true);
        } else if (items.when_to_send == 'ask') {
            // popup will open when clicked
        }
    })
});
