# simpleFastProxy
Nodejs based debugging proxy.

Currently the project is not well maintained. I'm developing only the features I need. I'm open to suggestions and help. The main objective of this project is providing a very flexible and easy to use debugging proxy. No SSL support yet. Later goals include providing a web based UI for inspecting traffic. 

# Usage

Import it;

    var proxy = require('./proxy.js');

The proxy gets a rule list as an array. Init the proxy with this array;

    var myProxy = new proxy.Proxy(mainRuleList);

See main.js for an example.
Each item can have a "match" field that will match a request specific to that rule item. Multiple matches are ORed.

      match: [
        {
          type: "requestHeader",
          name: "origin",
          value: ""
        }
      ]
      
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

      match: [
        {
          type: "requestHeader",
          name: "range"
        }
      ],
      modify: [
        {
          type: "responseHeader",
          name: "accept-ranges",
          value: 'none'
        }
      ]

You can cache files by setting "cache" property;

      cache: true
  
Modify response body;

      modify: [
        {
          type: "responseBody",
          search: "https:",
          replace: "http:"
        }
      ]
    
There are few additional oprions inside proxy.js;

Set port and temporary file folder;

    var SERVER_PORT = 8888;
    var TMP_FOLDER = "/tmp/";

Set replacement placeholders;
    
    var REPLACEMENT_PLACEHOLDER_OPEN = "{~{";
    var REPLACEMENT_PLACEHOLDER_CLOSE = "}~}";

Set a secondary proxy;

    var PROXY_HOST = null;
    var PROXY_PORT = null;

