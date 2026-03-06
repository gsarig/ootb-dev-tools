'use strict';

const store = new Map();
const MAX_SIZE = 100;

function set(key, value, ttl) {
	if (store.has(key)) {
		store.delete(key);
	}
	const entry = {
		value: value,
		expires: ttl ? new Date().getTime() + ttl : null,
	};
	store.set(key, entry);
	if (store.size > MAX_SIZE) {
		const oldestKey = store.keys().next().value;
		if (oldestKey !== undefined) {
			store.delete(oldestKey);
		}
	}
}

function get(key) {
	const entry = store.get(key);
	if (entry == undefined) return null;
	if (entry.expires != null && new Date().getTime() > entry.expires) {
		store.delete(key);
		return null;
	}
	return entry.value;
}

function clear() {
	store.clear();
}

function size() {
	return store.size;
}

module.exports = { set, get, clear, size };
