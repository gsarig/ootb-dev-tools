'use strict';

const LEVELS = ['debug', 'info', 'warn', 'error'];
let currentLevel = 'info';

function setLevel(level) {
  if (LEVELS.indexOf(level) === -1) {
    console.error('Invalid log level: ' + level);
    return;
  }
  currentLevel = level;
}

function log(level, msg) {
  const levelIndex = LEVELS.indexOf(level);
  const currentIndex = LEVELS.indexOf(currentLevel);
  if (levelIndex < currentIndex) return;

  const prefix = '[' + level.toUpperCase() + ']';
  const ts = new Date().toISOString();
  const output = ts + ' ' + prefix + ' ' + msg;

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function debug(msg) { log('debug', msg); }
function info(msg)  { log('info', msg); }
function warn(msg)  { log('warn', msg); }
function error(msg) { log('error', msg); }

function formatError(err) {
  if (err instanceof Error) {
    return err.stack || err.message;
  } else {
    return String(err);
  }
}

module.exports = { setLevel, debug, info, warn, error, formatError };
