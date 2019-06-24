export default {
  files: [
    'test/**/*.test.*',
  ],
  compileEnhancements: false,
  extensions: [
    'ts'
  ],
  require: [
    'ts-node/register/transpile-only'
  ],
  failFast: false,
  tap: false,
  verbose: true,
}
