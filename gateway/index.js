let express = require('express')
let bodyParser = require('body-parser');
let mongoose = require('mongoose');
let api = require("./api")

let app = express();

function start(options) {
  var port = options.port || 8080;
  var host = options.host || '127.0.0.1';

  app.use(bodyParser.urlencoded({
    extended: true
  }));
  app.use(bodyParser.json());

  mongoose.connect(process.env.MONGODB_CS, { useNewUrlParser: true, useUnifiedTopology: true});
  var db = mongoose.connection;

  if(!db)
    console.log("Error connecting db")
  else
    console.log("Db connected successfully")

  app.use('/v1/', api)

  app.listen(port, host, function () {
    console.log(`Running gateway on port ${port} at ${host}`);
  });
}

module.exports = {
  start,
}
