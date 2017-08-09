#!/usr/bin/env node

var fs = require('fs');
var Proxy = require('./proxy').Proxy;

exports.Proxy = Proxy;

process.argv.forEach(function (val, index, array) {
	if(index == 2) {
        var config;
        var instance = null;
        var readConfig = function() {
            fs.readFile(val, function (err, data) {
                if (err) throw err;
                config = JSON.parse(data);
                instance = new Proxy(config[0], config[1]);
            });
        }

        fs.watchFile(val, function( )
        {
            console.log("Configuration changed, restarting service.");
            instance.stop();
            instance = null;
            readConfig();
        });

        readConfig();
	}
});