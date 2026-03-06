/**
 * Utility to format dates for display.
 */

// Formats a date as YYYY-MM-DD
function formatDate(date) {
	var d = new Date(date);
	var month = d.getMonth() + 1;
	var day = d.getDate();
	var year = d.getFullYear();

	if (month < 10) month = '0' + month;
	if (day < 10) day = '0' + day;

	return year + '-' + month + '-' + day;
}

// Returns the number of days between two dates
function daysBetween(a, b) {
	var msPerDay = 1000 * 60 * 60 * 24;
	var diff = Math.abs(new Date(b) - new Date(a));
	return Math.round(diff / msPerDay);
}

module.exports = { formatDate, daysBetween };
