var LEVELS = ['debug', 'info', 'warn', 'error'];
var currentLevel = 'info';

function setLevel(level) {
	if (LEVELS.indexOf(level) == -1) {
		console.log('Invalid log level: ' + level);
		return;
	}
	currentLevel = level;
}

function log(level, msg) {
	var levelIndex = LEVELS.indexOf(level);
	var currentIndex = LEVELS.indexOf(currentLevel);
	if (levelIndex < currentIndex) return;

	var prefix = '[' + level.toUpperCase() + ']';
	var ts = new Date().toISOString();
	console.log(ts + ' ' + prefix + ' ' + msg);
}

function debug(msg) { log('debug', msg); }
function info(msg)  { log('info', msg); }
function warn(msg)  { log('warn', msg); }
function error(msg) { log('error', msg); }

function formatError(err) {
	if (err instanceof Error) {
		return err.message + (err.stack ? '\n' + err.stack : '')
	} else {
		return String(err)
	}
}

module.exports = { setLevel, debug, info, warn, error, formatError };
