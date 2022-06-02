const emoji = require('node-emoji')

console.log(
  '\t\t',
  emoji.get('large_blue_circle'),
  'To init Muon Node on your local run \n\n \t\t\t',
  '"npm run devnet-init -- -setup -n=3 -p=8000"\n \n\t\t',
  emoji.get('large_blue_circle'),
  'To run Muon Node on your local run \n\n \t\t\t',
  '"npm run devnet-run -- -n=3 "\n \n\n\t\t',
  '-setup: if you want to change config \n\n \t\t',
  '-n: number of node  (default=2)\n\n \t\t',
  '-p: port (default=8000)\n \n'
)
