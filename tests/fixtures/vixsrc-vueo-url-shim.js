// Extracted unchanged from VUEO PluginRuntime.kt URL/URLSearchParams compatibility layer.
// __vueoUrlOp is supplied by the test host, using Node URL to simulate native parsing.
function __vueoNativeUrl(input, base) {
                          var raw = __vueoUrlOp(
                            JSON.stringify({
                              input: String(input),
                              base:
                                base == null
                                  ? ""
                                  : String(
                                      base.href ||
                                      base
                                    )
                            })
                          );

                          var parsed = JSON.parse(raw);

                          if (parsed.error) {
                            throw new TypeError(parsed.error);
                          }

                          return parsed;
                        }

                        globalThis.URLSearchParams =
                          function (initial) {
                            this._pairs = [];

                            if (
                              initial &&
                              initial._pairs &&
                              Array.isArray(initial._pairs)
                            ) {
                              this._pairs =
                                initial._pairs.map(
                                  function (pair) {
                                    return [
                                      String(pair[0]),
                                      String(pair[1])
                                    ];
                                  }
                                );
                              return;
                            }

                            if (Array.isArray(initial)) {
                              for (
                                var ai = 0;
                                ai < initial.length;
                                ai++
                              ) {
                                if (
                                  initial[ai] &&
                                  initial[ai].length >= 2
                                ) {
                                  this.append(
                                    initial[ai][0],
                                    initial[ai][1]
                                  );
                                }
                              }
                              return;
                            }

                            if (typeof initial === "string") {
                              var source =
                                initial.charAt(0) === "?"
                                  ? initial.slice(1)
                                  : initial;

                              if (source) {
                                var parts = source.split("&");

                                for (
                                  var i = 0;
                                  i < parts.length;
                                  i++
                                ) {
                                  if (!parts[i]) continue;

                                  var eq =
                                    parts[i].indexOf("=");

                                  var rawKey =
                                    eq >= 0
                                      ? parts[i].slice(0, eq)
                                      : parts[i];

                                  var rawValue =
                                    eq >= 0
                                      ? parts[i].slice(eq + 1)
                                      : "";

                                  this.append(
                                    decodeURIComponent(
                                      rawKey.replace(/\+/g, " ")
                                    ),
                                    decodeURIComponent(
                                      rawValue.replace(/\+/g, " ")
                                    )
                                  );
                                }
                              }
                              return;
                            }

                            if (
                              initial &&
                              typeof initial === "object"
                            ) {
                              var keys =
                                Object.keys(initial);

                              for (
                                var j = 0;
                                j < keys.length;
                                j++
                              ) {
                                this.append(
                                  keys[j],
                                  initial[keys[j]]
                                );
                              }
                            }
                          };

                        URLSearchParams.prototype.append =
                          function (key, value) {
                            this._pairs.push([
                              String(key),
                              String(value)
                            ]);
                          };

                        URLSearchParams.prototype.set =
                          function (key, value) {
                            this.delete(key);
                            this.append(key, value);
                          };

                        URLSearchParams.prototype.get =
                          function (key) {
                            key = String(key);

                            for (
                              var i = 0;
                              i < this._pairs.length;
                              i++
                            ) {
                              if (
                                this._pairs[i][0] === key
                              ) {
                                return this._pairs[i][1];
                              }
                            }

                            return null;
                          };

                        URLSearchParams.prototype.getAll =
                          function (key) {
                            key = String(key);

                            return this._pairs
                              .filter(function (pair) {
                                return pair[0] === key;
                              })
                              .map(function (pair) {
                                return pair[1];
                              });
                          };

                        URLSearchParams.prototype.has =
                          function (key) {
                            return this.get(key) !== null;
                          };

                        URLSearchParams.prototype.delete =
                          function (key) {
                            key = String(key);

                            this._pairs =
                              this._pairs.filter(
                                function (pair) {
                                  return pair[0] !== key;
                                }
                              );
                          };

                        URLSearchParams.prototype.keys =
                          function () {
                            return this._pairs
                              .map(function (pair) {
                                return pair[0];
                              })
                              [Symbol.iterator]();
                          };

                        URLSearchParams.prototype.values =
                          function () {
                            return this._pairs
                              .map(function (pair) {
                                return pair[1];
                              })
                              [Symbol.iterator]();
                          };

                        URLSearchParams.prototype.entries =
                          function () {
                            return this._pairs
                              .map(function (pair) {
                                return [
                                  pair[0],
                                  pair[1]
                                ];
                              })
                              [Symbol.iterator]();
                          };

                        URLSearchParams.prototype.forEach =
                          function (callback, thisArg) {
                            for (
                              var i = 0;
                              i < this._pairs.length;
                              i++
                            ) {
                              callback.call(
                                thisArg,
                                this._pairs[i][1],
                                this._pairs[i][0],
                                this
                              );
                            }
                          };

                        URLSearchParams.prototype.toString =
                          function () {
                            return this._pairs
                              .map(function (pair) {
                                return (
                                  encodeURIComponent(pair[0])
                                    .replace(/%20/g, "+") +
                                  "=" +
                                  encodeURIComponent(pair[1])
                                    .replace(/%20/g, "+")
                                );
                              })
                              .join("&");
                          };

                        if (
                          typeof Symbol !== "undefined" &&
                          Symbol.iterator
                        ) {
                          URLSearchParams.prototype[
                            Symbol.iterator
                          ] =
                            URLSearchParams.prototype.entries;
                        }

                        globalThis.URL =
                          function (input, base) {
                            var parsed =
                              __vueoNativeUrl(
                                input,
                                base
                              );

                            this.href = parsed.href;
                            this.origin = parsed.origin;
                            this.protocol = parsed.protocol;
                            this.hostname = parsed.hostname;
                            this.host = parsed.host;
                            this.port = parsed.port;
                            this.pathname = parsed.pathname;
                            this.search = parsed.search;
                            this.hash = parsed.hash;
                            this.searchParams =
                              new URLSearchParams(
                                parsed.queryPairs || []
                              );
                          };

                        URL.prototype.toString =
                          function () {
                            return this.href;
                          };

                        URL.prototype.toJSON =
                          function () {
                            return this.href;
                          };

                        