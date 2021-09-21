### Run
    $ env-cmd babel-node index.js
    
#### Run with custom .env file

    $ env-cmd -f ./1.env babel-node index.js
    

### Auto Update
By enabling auto update any commit to the repository will trigger the update and server will restart.
#### Enable
    bash ./scripts/auto-update.sh "setup"
#### Update credentials
    cat >>~/.netrc <<EOF
    machine github.com
        login <USERNAME>
        password <PASSWORD>
    EOF
