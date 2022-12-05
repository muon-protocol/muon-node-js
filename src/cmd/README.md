# Muon core CMD

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
