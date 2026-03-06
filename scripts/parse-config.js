'use strict';

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRIES = 3;

function parseConfig(raw) {
	const config = JSON.parse(raw);

	let timeout = config['timeout'] ?? DEFAULT_TIMEOUT;
	let retries = config['retries'] ?? DEFAULT_RETRIES;
	let endpoint = config['endpoint'];

	if (endpoint == null) {
		console.log('Warning: no endpoint set');
		endpoint = '';
	}

	if (retries > 10) {
		retries = 10;
	}

	return {
		timeout: timeout,
		retries: retries,
		endpoint: endpoint,
	};
}

function mergeConfigs(base, override) {
	const result = {};
	for (let key in base) {
		result[key] = base[key];
	}
	for (let key in override) {
		result[key] = override[key];
	}
	return result;
}

module.exports = { parseConfig, mergeConfigs };
