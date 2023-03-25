#!/bin/bash
. ~/.bashrc
GIT_MERGE_AUTOEDIT=no

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
    `git checkout package-lock.json package.json`

    # restart services
    if [[ -z $_NODE ]]
    then
        _NODE=`which node`;
    fi

    if [[ -z $_NODE ]]
    then
        _NODE=/usr/local/bin/node # node Docker
        _PM2=/usr/local/bin/pm2
        _NPM=/usr/local/bin/npm
    fi

    git checkout package.json package-lock.json
    update_check=`git pull --recurse-submodules origin "$current_branch" 2>&1`
    
    if [ $? -ne 0 ]; then
        log "Git pull error.";
        log "$update_check;"
        exit;
    fi

    if echo $update_check | grep -q 'Already up to date'; then
        echo "No new updates";
    else
        log "========== updating detected ===========";
        log "============ update reason =============";
        log "$update_check"
        log "========================================";
        log "Installing dependencies: $_NODE  $_NPM install";
        log `pwd`;
        log `$_NODE  $_NPM install`
        log `npm install 2>&1`
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
