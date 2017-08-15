var crypto = require('crypto');
var fs = require('fs');
var net = require('net');
var http = require('http');
var https = require('https');
var zlib = require('zlib');
var urlParser = require('url');

var pem = require('pem');

var DrainedWriter = require('./drainedWriter');

exports.Proxy = function(mainRuleList, options) {
    var SERVER_PORT = options.port || 8888;
    var TMP_FOLDER = options.tempFolder || "/tmp/";
    var REPLACEMENT_PLACEHOLDER_OPEN = "{~{";
    var REPLACEMENT_PLACEHOLDER_CLOSE = "}~}";

    var PROXY_HOST = options.externalProxyHost || null;
    var PROXY_PORT = options.externalProxyPort || null;

    var cachedURLs;
    var server = null;
    var httpsServer = null;

    if (!fs.existsSync(TMP_FOLDER + 'cachedURLs.json')) {
        fs.writeFile(TMP_FOLDER + 'cachedURLs.json', "{}");
    }

    fs.readFile(TMP_FOLDER + 'cachedURLs.json', function (err, data) {
        if (err) throw err;
        cachedURLs = JSON.parse(data);
        startServer();
    });

    function startServer() {
        server = http.createServer().listen(SERVER_PORT);
        
        server.on("connect", function(req, cltSocket, head) {
            var host = req.url.split(":")[0];
            var port = req.url.split(":")[1];

            if(options.interceptSSL) {
                var opts = {
                    days: 1,
                    serviceKey: fs.readFileSync(options.rootCAKey).toString(),
                    serviceCertificate: fs.readFileSync(options.rootCACert).toString(),
                    serviceKeyPassword: options.rootCAPass,
                    altNames:[host]
                };

                pem.createCertificate(opts, function(err, keys) {
                    httpsServer = https.createServer({
                        key: keys.clientKey,
                        cert: keys.certificate,
                        passphrase: options.rootCAPass
                    }, serverHandler.bind(this, "https")).listen(0, 'localhost');

                    // TODO: directly write to https server
                    httpsServer.on("listening", function() {
                        if(!httpsServer.listening)
                            return;
                        var addr = httpsServer.address()
                        var srvSocket = net.createConnection(addr.port, addr.address, function() {
                            cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                                    'Proxy-agent: Node.js-simpleFastProxy\r\n' +
                                    '\r\n');
                            srvSocket.write(head)
                            srvSocket.pipe(cltSocket);
                            cltSocket.pipe(srvSocket);
                        });
                    })
                })
            } else {
                //Direct tunneling
                var srvSocket = net.createConnection(port, host, function() {
                    cltSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                            'Proxy-agent: Node.js-simpleFastProxy\r\n' +
                            '\r\n');
                    srvSocket.write(head)
                    srvSocket.pipe(cltSocket);
                    cltSocket.pipe(srvSocket);
                });
            }
        });

        server.on("request", serverHandler.bind(this, "http"));
        console.log('Server started')
    }

    function serverHandler(protocol, request, response) {
        var parsedURL = urlParser.parse(request.url);

        var headerHost = request.headers['host'];
        var parsedHost = parsedURL.host ? parsedURL.host.split(":")[0] : null;

        var targetHost = headerHost || parsedHost;
        var targetPort = parsedURL.port;

        var host = PROXY_HOST || targetHost;
        var port = PROXY_PORT || targetPort || (protocol == "https" ? 443 : 80);

        var doCache;
        var doRequest = true;
        var writer;
        var dWriter;
        var filename;
        var matchList = new Array(mainRuleList.length);

        function manipulateRequest(requestHeaders) {
            var waitingForBodyManipulation = false;
            for (var i = 0; i < mainRuleList.length; i++) {
                var currentRule = mainRuleList[i];
                var isMatched = matchList[i]; //assume previous value

                if (currentRule.match) {
                    matchLoop:
                        for (var matcher = 0; matcher < currentRule.match.length; matcher++) {
                            var currentMatch = currentRule.match[matcher];
                            switch (currentMatch.type) {
                                case 'requestHeader':
                                    if (!(requestHeaders[currentMatch.name] &&
                                        (!currentMatch.value || requestHeaders[currentMatch.name] === currentMatch.value))) {
                                        isMatched = false;
                                        break matchLoop;
                                    }
                                    break;
                            }
                        }
                }

                if (isMatched && currentRule.modify) {
                    for (var modifier = 0; modifier < currentRule.modify.length; modifier++) {
                        var currentModifier = currentRule.modify[modifier];
                        switch (currentModifier.type) {
                            case 'requestHeader':
                                var newValue = replacePlaceHolders(currentModifier.value);
                                requestHeaders[currentModifier.name] = newValue;
                                break;
                        }
                    }
                }

                if (isMatched && currentRule.delete) {
                    for (var deleter = 0; deleter < currentRule.delete.length; deleter++) {
                        var currentDeleter = currentRule.delete[deleter];
                        switch (currentDeleter.type) {
                            case 'requestHeader':
                                delete requestHeaders[currentDeleter.name];
                                break;
                        }
                    }
                }
            }
            return waitingForBodyManipulation;
        }

        //On pre request
        for (var i = 0; i < mainRuleList.length; i++) {
            var currentRule = mainRuleList[i];
            var isMatched = true; //assume a match
            if (currentRule.match) {
                matchLoop:
                    for (var matcher = 0; matcher < currentRule.match.length; matcher++) {
                        var currentMatch = currentRule.match[matcher];
                        switch (currentMatch.type) {
                            case 'requestHeader':
                                if (!(request.headers[currentMatch.name] &&
                                    (!currentMatch.value || request.headers[currentMatch.name] === currentMatch.value))) {
                                    isMatched = false;
                                    break matchLoop;
                                }
                                break;
                            case 'url':
                                var actualURL = protocol == "https" ? ("https://" + targetHost + request.url) : request.url;
                                if (actualURL.indexOf(currentMatch.value) < 0) {
                                    isMatched = false;
                                    break matchLoop;
                                }
                                break;
                        }
                    }
            }
            matchList[i] = isMatched;

            if (isMatched && currentRule.cache) {
                var hash = crypto.createHash('sha256');
                hash.update(targetHost + parsedURL.path);
                filename = hash.digest('hex');

                if (cachedURLs[filename] && fs.existsSync(TMP_FOLDER + filename)) {
                    doRequest = false;
                } else {
                    doCache = true;

                    if (fs.existsSync(TMP_FOLDER + filename))
                        fs.unlinkSync(TMP_FOLDER + filename);

                    writer = fs.createWriteStream(TMP_FOLDER + filename, {
                        flags: 'a'
                    });

                    dWriter = new DrainedWriter(writer)
                }
            }
        }

        console.log("REQUEST ("+protocol+"): " + targetHost + " (" + request.url + ")");

        function substituteValue(currentReplacement) {
            var splitReplacement = currentReplacement.split(".");
            if (splitReplacement.length > 1) {
                switch (splitReplacement[0]) {
                    case 'requestHeader':
                        return request.headers[splitReplacement[1]];
                        break;
                }
            } else {
                return currentReplacement;
            }
        }

        function replacePlaceHolders(currentValue) {
            var replacements = currentValue.split(REPLACEMENT_PLACEHOLDER_OPEN);
            var result = "";
            for (var i = 0; i < replacements.length; i++) {
                var currentReplacement = replacements[i];
                var splitReplacement = currentReplacement.split(REPLACEMENT_PLACEHOLDER_CLOSE);
                if (splitReplacement.length > 1) {
                    result += substituteValue(splitReplacement[0]) + splitReplacement[1];
                } else {
                    result += splitReplacement[0];
                }
            }
            return result;
        }

        function manipulateResponse(responseHeaders) {
            var waitingForBodyManipulation = false;
            for (var i = 0; i < mainRuleList.length; i++) {
                var currentRule = mainRuleList[i];
                var isMatched = matchList[i]; //assume previous value

                if (currentRule.match) {
                    matchLoop:
                        for (var matcher = 0; matcher < currentRule.match.length; matcher++) {
                            var currentMatch = currentRule.match[matcher];
                            switch (currentMatch.type) {
                                case 'responseHeader':
                                    if (!(responseHeaders[currentMatch.name] &&
                                        (!currentMatch.value || responseHeaders[currentMatch.name] === currentMatch.value))) {
                                        isMatched = false;
                                        break matchLoop;
                                    }
                                    break;
                            }
                        }
                }

                if (isMatched && currentRule.modify) {
                    for (var modifier = 0; modifier < currentRule.modify.length; modifier++) {
                        var currentModifier = currentRule.modify[modifier];
                        switch (currentModifier.type) {
                            case 'responseHeader':
                                var newValue = replacePlaceHolders(currentModifier.value);
                                responseHeaders[currentModifier.name] = newValue;
                                break;
                            case 'responseBody':
                                waitingForBodyManipulation = true;
                                break;
                        }
                    }
                }

                if (isMatched && currentRule.delete) {
                    for (var deleter = 0; deleter < currentRule.delete.length; deleter++) {
                        var currentDeleter = currentRule.delete[deleter];
                        switch (currentDeleter.type) {
                            case 'responseHeader':
                                delete responseHeaders[currentDeleter.name];
                                break;
                        }
                    }
                }
            }
            return waitingForBodyManipulation;
        }

        var doNetworkRequest = function () {
            var tmpRequestHeaders = JSON.parse(JSON.stringify(request.headers));
            manipulateRequest(tmpRequestHeaders);

            if(protocol == "https") {
                var agent = https;
            } else {
                var agent = http;
            }

            var proxy_request = agent.request({
                port: port,
                host: host,
                method: request.method,
                headers: tmpRequestHeaders,
                path: parsedURL.pathname + (parsedURL.search ? parsedURL.search : "")
            });
            proxy_request.addListener('response', function (proxy_response) {
                var waitingForBodyManipulation = manipulateResponse(proxy_response.headers);

                if (!waitingForBodyManipulation) {
                    response.writeHead(proxy_response.statusCode, proxy_response.headers);
                }

                var rawData = [];

                proxy_response.on('data', function (chunk) {
                    if (waitingForBodyManipulation) {
                        rawData.push(chunk);
                    } else {
                        response.write(chunk);
                    }

                    if (doCache) {
                        dWriter.write(chunk);
                    }
                });

                proxy_response.on('end', function () {
                    var finalDataReady = function() {
                        if (doCache) {
                            function finishCacheOperation() {
                                writer.end();

                                cachedURLs[filename] = {};
                                cachedURLs[filename].statusCode = proxy_response.statusCode;
                                cachedURLs[filename].headers = proxy_response.headers;

                                fs.writeFile(TMP_FOLDER + "cachedURLs.json", JSON.stringify(cachedURLs));

                                console.log("CACHED: " + targetHost + " (" + request.url + ")");
                            }

                            dWriter.end(finishCacheOperation);
                        }

                        if (waitingForBodyManipulation) {
                            proxy_response.headers["content-length"] = rawData.length;
                            response.writeHead(proxy_response.statusCode, proxy_response.headers);
                            response.write(rawData);
                        }

                        response.end();
                    }

                    if (waitingForBodyManipulation) {
                        var manipulateBody = function() {
                            for (var modifier = 0; modifier < currentRule.modify.length; modifier++) {
                                var currentModifier = currentRule.modify[modifier];
                                switch (currentModifier.type) {
                                    case 'responseBody':
                                        rawData = Buffer.concat(rawData);

                                        var newValue = replacePlaceHolders(currentModifier.replace);
                                        rawData = rawData.toString('utf8');
                                        rawData = rawData.replace(new RegExp(currentModifier.search), newValue);
                                        proxy_response.headers['content-encoding'] = "";
                                        break;
                                }
                            }
                        }

                        //unzip if necessary
                        if (proxy_response.headers['content-encoding'] == "gzip") {
                            zlib.unzip(rawData, function (err, buffer) {
                                if (!err) {
                                    proxy_response.headers['content-encoding'] = "";
                                    manipulateBody();
                                    finalDataReady();
                                } else {
                                    finalDataReady();
                                    // handle error
                                }
                            });
                        } else {
                            manipulateBody();
                            finalDataReady();
                        }
                    } else {
                        //No need for decoding
                        finalDataReady();
                    }
                });
            });

            proxy_request.on('error', function (err) {
                console.log(err + targetHost + " (" + request.url + ")");
                response.statusCode = "404";
                response.end();

                if (doCache) {
                    writer.end();
                }
            });

            request.addListener('data', function (chunk) {
                proxy_request.write(chunk, 'binary');
            });

            request.addListener('end', function () {
                proxy_request.end();
            });
        };

        //Do request
        if (doRequest) {
            doNetworkRequest();
        } else {
            function cacheErrorHandler() {
                delete cachedURLs[filename];
            }

            var reader = fs.createReadStream(TMP_FOLDER + filename, {
                flags: 'r'
            });

            var tmpHeaders = JSON.parse(JSON.stringify(cachedURLs[filename].headers));
            manipulateResponse(tmpHeaders);

            response.writeHead(cachedURLs[filename].statusCode, tmpHeaders);

            console.log("From cache: " + "(" + filename + ")" + targetHost + " (" + request.url + ")");

            var dResponseWriter = new DrainedWriter(response);

            var contentLength = 0;
            reader.addListener('data', function (chunk) {
                contentLength += chunk.length;
                dResponseWriter.write(chunk);
            });

            reader.addListener('end', function (data) {
                dResponseWriter.end(function () {
                    if (cachedURLs[filename].headers['content-length'] != contentLength) {
                        console.log("ERROR: " + "(" + filename + ")" + targetHost + " (" + request.url + ")" + "[" + cachedURLs[filename].headers['content-length'] + "!=" + contentLength + "]" + data);
                        cacheErrorHandler();
                    }
                    response.end();
                });
            });

            reader.addListener('error', function () {
                console.log("READER ERROR");
                cacheErrorHandler();
                response.end();
            });
        }
    }

    this.stop = function() {
        server
            .close()
            .on('close', () => console.log('Server stopped'))
            .on('error', (e) => console.log('Error stopping server:', e));
    }
}