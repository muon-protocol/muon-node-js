### Cloning this repository
Because of containing submodule, add the `--recurse-submodules` flag to the `clone`/`pull` commands.

    $ git clone <the-repo> --recurse-submodules
    $ git pull --recurse-submodules
If you already cloned the old repo before the `apps` submodule, run the code below

    $ git submodule init 
### Run
    $ env-cmd babel-node index.js
    
#### Run with custom .env file

    $ env-cmd -f ./1.env babel-node index.js
    
### Auto Update
By enabling auto update any commit to the repository will trigger the update and server will restart.
#### Enable
    bash ./scripts/auto-update.sh -a setup -p '<PM2_APP_NAME|PM2_APP_ID>'
#### Update credentials

    cat >>~/.netrc <<EOF
    machine github.com
        login <USERNAME>
        password <PASSWORD>
    EOF

#### Local devnet
You can run local devnet on port 8080

    docker-compose build --build-arg INFURA_PROJECT_ID=< your infura project id >
    docker-compose up

To check local devnet open http://localhost:8080/v1/?app=tss&method=test in your browser.

After any changes, you will need to build again.

########
