const parseArgv = () => {
  let args = process.argv.slice(2)
  let params = args.filter((arg) => arg.startsWith('-'))
  let result = {}
  params.map((p) => {
    let [key, value] = p.split('=')
    result[key.slice(1)] = value === undefined ? true : value
  })
  return result
}
export default parseArgv
