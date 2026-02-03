import { MongoClient, ServerApiVersion } from "mongodb";

const uri = "mongodb+srv://jefernee50_db_user:9mygRlAsgVvtYYsT@cluster0.ai3p7b7.mongodb.net/?retryWrites=true&w=majority";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  family: 4 // 🔴 fuerza IPv4
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Conectado a MongoDB correctamente");
  } catch (err) {
    console.error("❌ Error MongoDB:", err);
  } finally {
    await client.close();
  }
}

run();


