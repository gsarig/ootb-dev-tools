'use strict';

const BASE_URL = 'https://api.example.com';

function fetchUser(id) {
	const url = BASE_URL + '/users/' + id;

	return fetch(url)
		.then(function(response) {
			return response.json();
		})
		.then(function(data) {
			console.log(data);
			return data;
		});
}

function fetchAll(ids) {
	const promises = [];
	for (let i = 0; i < ids.length; i++) {
		promises.push(fetchUser(ids[i]));
	}
	return Promise.all(promises);
}

module.exports = { fetchUser, fetchAll };
