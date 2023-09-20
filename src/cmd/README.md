# Muon core CMD
## Config file
The cdm config file is located at `src/cmd/cmd.conf.json`. At the root of this json file networks are defined and in each different network there are configs of that specific network. 

Here is an example of how it should look like:

```$xslt
{
  "local": {
    "url": "http://127.0.0.1:8000/v1",
    "deployers": [
      "http://127.0.0.1:8000/v1/",
      "http://127.0.0.1:8001/v1/"
    ]
  },
  "alice": {
    "url": "http://alice-v2.muon.net/v1"
    "deployers": [
      "http://alice-v2.muon.net/v1"
    ]
  }
}
```

## Config commands
    ts-node ./src/cmd config <set|get> <key> <value>
Muon api URL is mandatory. It should be set before any other commands.

    ts-node ./src/cmd config set url "http://localhost:8000/v1"
    
## App commands
Deploy or reshare apps.

    # deploy
    $ ts-node ./src/cmd app deploy <app-name>
    
    # reshare app tss key
    $ ts-node ./src/cmd app reshare <app-name>

## Network commands
