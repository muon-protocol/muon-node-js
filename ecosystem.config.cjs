module.exports = {
  apps : [{
    "name": "muon-node-js-testnet",
    "script": "npm",
    "args" : "start",
    "watch"  : false,
    "ignore_watch": ["node_modules"],
    "log_date_format" : "YYYY-MM-DD HH:mm",
    "autorestart": false,
    "max_memory_restart": "2G",
    "node_args": "--max_old_space_size=3072",

    "env": {
      "NODE_ENV": "production"
    },
    "env_production" : {
       "NODE_ENV": "production"
    }

  }]
}
