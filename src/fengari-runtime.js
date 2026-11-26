// Select the Lua core and portable standard libraries for embedded scripting.
// Host-specific I/O, networking and filesystem integration belong to the caller.
module.exports = {
  lua: require('fengari/src/lua.js'),
  aux: require('fengari/src/lauxlib.js'),
  to_luastring: require('fengari/src/fengaricore.js').to_luastring,
  luaopen_base: require('fengari/src/lbaselib.js').luaopen_base,
  luaopen_coroutine: require('fengari/src/lcorolib.js').luaopen_coroutine,
  luaopen_math: require('fengari/src/lmathlib.js').luaopen_math,
  luaopen_string: require('fengari/src/lstrlib.js').luaopen_string,
  luaopen_table: require('fengari/src/ltablib.js').luaopen_table,
  luaopen_utf8: require('fengari/src/lutf8lib.js').luaopen_utf8,
};
