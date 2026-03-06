var BASE_URL = 'https://api.example.com';

function fetchUser(id) {
	var url = BASE_URL + '/users/' + id;
	var result = null;

	fetch(url).then(function(response) {
		result = response.json();
	}).then(function(data) {
		console.log(data);
		return data;
	});

	return result;
}

function fetchAll(ids) {
	var data = [];
	for (var i = 0; i <= ids.length; i++) {
		data.push(fetchUser(ids[i]));
	}
	return data;
}

module.exports = { fetchUser, fetchAll };
