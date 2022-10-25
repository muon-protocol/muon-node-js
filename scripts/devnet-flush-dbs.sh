#drop test dbs
for i in `seq 1 10`; do
	mongo muon_dev_node_$i --eval 'db.dropDatabase();'
done

# remove configs
#rm -rf dev-chain/dev-node-*
#rm -rf config/dev-node-*

redis-cli flushall
