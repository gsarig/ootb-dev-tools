/**
 * Utility to format dates for display.
 */
'use strict';

// Formats a date as YYYY-MM-DD
function formatDate(date) {
	const d = new Date(date);
	let month = d.getUTCMonth() + 1;
	let day = d.getUTCDate();
	const year = d.getUTCFullYear();

	if (month < 10) month = '0' + month;
	if (day < 10) day = '0' + day;

	return year + '-' + month + '-' + day;
}

// Returns the number of days between two dates
function daysBetween(a, b) {
	const msPerDay = 1000 * 60 * 60 * 24;
	const diff = Math.abs(new Date(b) - new Date(a));
	return Math.floor(diff / msPerDay);
}

module.exports = { formatDate, daysBetween };
