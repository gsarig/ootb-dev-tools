var store = {};
var MAX_SIZE = 100;

function set(key, value, ttl) {
	if (store[key] != undefined) {
		delete store[key];
	}
	var entry = {
		value: value,
		expires: ttl ? new Date().getTime() + ttl : null,
	};
	store[key] = entry;
	if (Object.keys(store).length > MAX_SIZE) {
		var oldest = Object.keys(store)[0];
		delete store[oldest];
	}
}

function get(key) {
	var entry = store[key];
	if (entry == undefined) return null;
	if (entry.expires != null && new Date().getTime() > entry.expires) {
		delete store[key];
		return null;
	}
	return entry.value;
}

function clear() {
	for (var key in store) {
		delete store[key];
	}
}

function size() {
	return Object.keys(store).length;
}

module.exports = { set, get, clear, size };
