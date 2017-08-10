# simpleFastProxy
[![npm](https://img.shields.io/npm/dt/sfp.svg)]()

Nodejs based debugging proxy.

Currently I'm developing only the features I need. I'm open to suggestions and help. The main objective of this project is providing a very flexible and easy to use debugging proxy. No SSL support yet. Later goals include providing a web based UI for inspecting traffic. 

# Usage

Import it;

    var sfp = require('sfp');

The proxy gets a rule list as an array. Init the proxy with this array and an options object;

    var myProxy = new sfp.Proxy(mainRuleList, options);

Each item in the rule list array can have a "match" field that will match a request specific to that rule item. Multiple matches are ORed.

    {
        //Optional match property
        match: [
            {
               ...
            },
            ...
        ],
        //Action items when the match is valid
        //(modify, delete, cache)
        ...
    }

For example to match a request header;
    

    match: [
        {
            type: "requestHeader",
            name: "origin",
            value: "..."
        }
    ]
    
or match a request header without using a value;
    
    match: [
		{
			type: "requestHeader",
			name: "range"
		}
	]
    
Allowed match types are currently; requestHeader, responseHeader or url.
      
## Action Items:
      
You can modify a header using placeholders from request headers. Inject origin for CORS, or allow credentials;

	modify: [
		{
			type: "responseHeader",
			name: "access-control-allow-origin",
			value: '{~{requestHeader.origin}~}'
		},
		{
			type: "responseHeader",
			name: "access-control-allow-credentials",
			value: 'true'
		}
	]

Inject origin;

	modify: [
		{
			type: "requestHeader",
			name: "origin",
			value: ''
		},
		{
			type: "requestHeader",
			name: "referer",
			value: ''
		}
	]
    
Injecting a cookie;

	modify: [
		{
			type: "requestHeader",
			name: "cookie",
			value: ''
		}
	]
    
Prevent cache;

	modify: [
		{
			type: "responseHeader",
			name: "cache-control",
			value: 'no-cache, no-store, must-revalidate'
		},
		{
			type: "responseHeader",
			name: "pragma",
			value: 'no-cache'
		},
		{
			type: "responseHeader",
			name: "expires",
			value: '0'
		}
	]
		  
Remove headers;

	delete: [
		{
			type: "responseHeader",
			name: "x-frame-options",
			value: ''
		},
		{
			type: "responseHeader",
			name: "accept-ranges",
			value: ''
		}
	]
    
Remove accept-ranges response header if a range request arrives;

    modify: [
    {
        type: "responseHeader",
        name: "accept-ranges",
        value: 'none'
    }

You can cache files by setting "cache" property;

    cache: true
  
Modify response body (use search & replace instead of name/value);

	modify: [
		{
			type: "responseBody",
			search: "https:",
			replace: "http:"
		}
	]
    
## Options:

	{
		"port": 8888 //Proxy port (defaults to 8888),
		"tempFolder": "/tmp/", //Temporary file folder (defaults to "/tmp/"),
		"externalProxyHost": null, //Additional proxy host and port (requests will be further forwarded to this endpoint);
		"externalProxyPort": null,
		"interceptSSL": true, //Should the proxy intercept HTTPS requests? Below options are necessary if this is true.
		"rootCAKey": "path/to/rootCA/key", //root CA key file (.key)
		"rootCACert": "path/to/rootCA/cert", //root CA certificate file (.pem)
		"rootCAPass": "XXXX" //root CA passphrase
	}
	
## CLI

To run the proxy server from the command line, install it globally and pass a json file name. In the json file theremust be an array of two objects. The first one will be used as the mainRuleList and second the options object.

For example;

	[
		[],
		{
			"tempFolder": "/tmp/"
		}
	]
