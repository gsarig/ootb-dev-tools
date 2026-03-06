var DEFAULT_TIMEOUT = 5000;
var DEFAULT_RETRIES = 3;

function parseConfig(raw) {
	var config = JSON.parse(raw);

	var timeout = config['timeout'] ? config['timeout'] : DEFAULT_TIMEOUT;
	var retries = config['retries'] ? config['retries'] : DEFAULT_RETRIES;
	var endpoint = config['endpoint'];

	if (endpoint == null || endpoint == undefined) {
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
	var result = {};
	for (var key in base) {
		result[key] = base[key];
	}
	for (var key in override) {
		result[key] = override[key];
	}
	return result;
}

module.exports = { parseConfig, mergeConfigs };
