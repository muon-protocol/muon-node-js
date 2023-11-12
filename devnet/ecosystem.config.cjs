module.exports = {
  apps : [{
    "name": "muon-1",
    "script": "NODE_OPTIONS=--max-old-space-size=3072 npm run dev-node-1",
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
    },
  },{
    "name": "muon-2",
    "script": "NODE_OPTIONS=--max-old-space-size=3072 npm run dev-node-2",
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
    },
  }]
}
