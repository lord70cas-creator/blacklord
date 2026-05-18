

const config = require("./config.json");
const client = require("./bot");

client.login(config.token);



require("./server");
