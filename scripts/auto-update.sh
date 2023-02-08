#!/bin/bash
. ~/.bashrc

. "`dirname "$0"`/pre-run.sh"

project_dir=`pwd`
absolute_path="`pwd`/scripts/`basename $0`"

log (){
    log_time=`date '+%Y-%m-%d %H:%M:%S'`;
    echo $*;
    `echo "[$log_time]:  $*" >> "$project_dir/auto-update.log";`
}

setup (){
    if [[ -z "$pm2_app" ]]
    then
        echo "ERROR: please specify pm2 app name with [ -p <APP_NAME|APP_ID>]"
        exit;
    fi
    backup=`crontab -l`
    new_cron="*/5 * * * * export _PM2=`which pm2`; export _NPM=`which npm`; export _PM2_APP='$pm2_app'; $absolute_path -a update"; # every 5 minutes
    if [[ "$backup" == *"$new_cron"* ]]
    then
        echo "Already exist.";
    else
        `crontab -l | { cat; echo "$new_cron"; } | crontab -`
        echo "Script successfully added to crontab."
    fi
}

check_for_update (){
    current_branch=`git rev-parse --abbrev-ref HEAD`
    `git checkout package-lock.json`

    # restart services
    if [[ -z $_NODE ]]
        # uses env _NODE by default
    then
        _NODE=`which node`;
    fi

    if [[ -z $_NODE ]]
    then
        _NODE=/usr/local/bin/node # node Docker
    fi

    log `$_NODE  $_NPM install`

    if git pull --recurse-submodules origin "$current_branch" | grep -q 'Already up to date'; then
#        log "Node: [`which node`]    PM2: [`which pm2`]";
        ``;
    else
        # restart services
        if [[ -z $_NODE ]]
            # uses env _NODE by default
        then
            _NODE=`which node`;
        fi

        if [[ -z $_NODE ]]
        then
            _NODE=/usr/local/bin/node # node Docker
        fi

        log "========== updating detected ===========";
        log "Installing dependencies: $_NODE  $_NPM install";
        log `pwd`;
        log `$_NODE  $_NPM install`
        log "Restarting PM2: $_NODE $_PM2 restart $_PM2_APP";
        log `$_NODE $_PM2 restart "$_PM2_APP"`
        log "============ updating done =============";
    fi
}

while getopts p:a: flag
do
    case "${flag}" in
        a) action=${OPTARG};;
        p) pm2_app=${OPTARG};;
    esac
done

if [[ "$action" == "setup" ]]
then
    log `setup`;
    exit 0;
elif [[ "$action" == "update" ]]
then
    check_for_update;
else
    log "No action defined.";
fi
