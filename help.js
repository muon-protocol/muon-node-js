const emoji = require('node-emoji')

console.log(
  '\t\t',
  emoji.get('large_blue_circle'),
  'To run Muon Node on your local run \n\n \t\t\t',
  '"npm run node -- -setup -n=2 -p=8080"\n \n\t\t\t',
  '-setup: if you want to change config \n\n \t\t\t',
  '-n: number of env \n\n \t\t\t',
  '-p: port\n \n'
)
