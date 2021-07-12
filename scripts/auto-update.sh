#!/bin/bash
. "`dirname "$0"`/pre-run.sh"

project_dir=`pwd`
absolute_path="`pwd`/scripts/`basename $0`"

log (){
    log_time=`date '+%Y-%m-%d %H:%M:%S'`;
    echo $*;
    `echo "[$log_time]:  $*" >> "$project_dir/auto-update.log";`
}

setup (){
    backup=`crontab -l`
    new_cron="*/5 * * * * export _PM2=`which pm2`; export _NPM=`which npm` $absolute_path"; # every 5 minutes
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

    if git pull origin "$current_branch" | grep -q 'Already up to date'; then
#        log "Node: [`which node`]    PM2: [`which pm2`]";
        ``;
    else
        # restart services
        log "========== updating detected ===========";
        log "Installing dependencies ...";
        log `$_NPM install`
        log "Restarting PM2 ...";
        log `$_PM2 restart all`
        log "============ updating done =============";
    fi
}

if [[ "$1" == "setup" ]]
then
    log `setup`;
    exit 1;
else
    check_for_update;
fi

