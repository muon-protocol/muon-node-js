module.exports = {
  apps : [{
    "name": "muon-node-js-alice2",
    "script": "NODE_OPTIONS=--max-old-space-size=3072 npm start",
    "watch"  : false,
    "ignore_watch": ["node_modules"],
    "log_date_format" : "YYYY-MM-DD HH:mm",
    "autorestart": false,
    "max_memory_restart": "3G",
    "env": {
      "NODE_ENV": "production"
    },
    "env_production" : {
       "NODE_ENV": "production"
    }

  }]
}
