// Saves options to chrome.storage
function save_options() {
    var when_to_send = $("input[name=when_to_send]:checked").val();
    var dollar_tip_amount = $('input[name=dollar_tip_amount]').val();
    var daily_tip_limit = $('input[name=daily_tip_limit]').val();
    var one_per_address = $("input[name=one_per_address]:checked").length

    chrome.storage.sync.set({
        when_to_send: when_to_send,
        dollar_tip_amount: dollar_tip_amount,
        daily_tip_limit: daily_tip_limit,
        one_per_address: one_per_address
    }, function() {
        // Update status to let user know options were saved.
        var status = document.getElementById('status');
        status.textContent = 'Options saved.';
        setTimeout(function() {
            status.textContent = '';
        }, 750);
    });
}

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
function restore_options() {
    // These are default values
    chrome.storage.sync.get({
        when_to_send: 'ask',
        dollar_tip_amount: 0.05,
        daily_tip_limit: 0.50,
        pub_key: 'none',
        priv_key: 'none',
        one_per_address: true,
    }, function(items) {
        if(items.pub_key == 'none' && items.priv_key == 'none') {
            //if keys have not been generated, do so now and save them.
            var key = new PrivateKey();
            items.pub_key = key.toAddress().toString();
            items.priv_key = key.toWIF();
            chrome.storage.sync.set({
                pub_key: items.pub_key,
                priv_key: items.priv_key
            });
        }
        $('input[name=when_to_send][value=' + items.when_to_send + ']').attr('checked', 'checked');
        $('input[name=dollar_tip_amount]').val(items.dollar_tip_amount);
        $('input[name=daily_tip_limit]').val(Number(items.daily_tip_limit).toFixed(2));
        $("#priv_key").text(items.priv_key);
        $('#deposit_address').text(items.pub_key);

        if(items.one_per_address) {
            $('input[name=one_per_address]').attr('checked', 'checked');
        }

        $.get("https://blockchain.info/rawaddr/" + items.pub_key, function(response) {
            var balance = response['final_balance'] / 1e8; //replace spinner
            $.get("https://winkdex.com/api/v0/price", function(response) {
                var cents_per_btc = response['price'];
                var fiat_amount = Number(cents_per_btc * balance / 100).toFixed(2);
                $('#current_balance').text(balance + " BTC (" + fiat_amount +" USD)" ); //replace spinner
            });
        });
    });
}

$('#save').on('click', save_options);
restore_options();
