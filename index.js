var http = require('http');
var express = require('express');
var AccessToken = require('./lib/AccessToken').AccessToken;
var Priviledges = require('./lib/AccessToken').priviledges;

var PORT = process.env.PORT || 8080;

// Verify that the API Key and API Secret are defined
if (!(process.env.APP_ID && process.env.APP_CERTIFICATE)) {
    throw new Error('You must define an APP_ID and APP_CERTIFICATE');
    process.exit();
}
// Get the Vendor and Sign Key
var APP_ID = process.env.APP_ID;
var APP_CERTIFICATE = process.env.APP_CERTIFICATE;

var app = express();
app.disable('x-powered-by');
app.set('port', PORT);
app.use(express.favicon());
app.use(app.router);
app.use(express.static(__dirname + '/public'));

var generateAccessToken = function(req, resp){
	resp.header('Access-Control-Allow-Origin', "*")
    var channelName = req.query.channelName;
    if (!channelName){
        return resp.status(400).json({'error':'channel name is required'}).send();
    }

    var uid = req.query.uid;
        if (!uid){
        return resp.status(400).json({'error':'uid is required'}).send();
    }

    var expiredTs = req.query.expiredTs;
        if (!expiredTs){
        return resp.status(400).json({'error':'expiredTs is required'}).send();
    }

    var key = new AccessToken(APP_ID, APP_CERTIFICATE, channelName, uid);
    key.addPriviledge(Priviledges.kJoinChannel, expiredTs);

    var token = key.build();

    return resp.json({'access_token': token}).send();
};

app.get('/app_id', function(req, res){
    if (!APP_ID){
        res.send(500, {
            error: "No APP_ID"
        });
    }
    res.send(APP_ID)
})

app.get('/access_token', generateAccessToken);

http.createServer(app).listen(app.get('port'), function() {
 	console.log('Agora WebRTC Live Broadcasting demo starts at ', app.get('port'));
});