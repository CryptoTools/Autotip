function found_tip(node) {
    localStorage[date] = node;
}

$("meta[name=microtip]").each(function(index, element) {
    var e = $(element);
    var address = e.data('address');
    var currency = e.data('currency');

    chrome.runtime.sendMessage({currency: currency, address: address});

    //console.log("found microtip", currency, address);
});
