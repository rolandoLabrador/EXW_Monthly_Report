import { MongoClient } from 'mongodb';



export class DatabaseService {
  private client: MongoClient;
  
  constructor(){
    this.client = new MongoClient(process.env.MONGO_URI!);

    
  }
async getContracts(){

    try {
        console.log("Attempting to connect to MongoDB...");
        await this.client.connect();
        console.log("Successfully connected to MongoDB!");

        const db=this.client.db("ContractDataDB");
        const collections= db.collection("ContractData");

        const query={
          "metadata.Agent":"EXW",
          "metadata.ContractStatus":"P"
        };

        return await collections.find(query).toArray();
    } catch (error) {
        console.error("\n MongoDB connection failed!");
        console.error("If you are getting a timeout, ensure your current IP address is added to the MongoDB Atlas Network Access allowlist.\n");
        console.error("Detailed Error:", error);
        throw error;
    }

}

async close (){
    try {
        await this.client.close();
        console.log("MongoDB connection gracefully closed.");
    } catch (error) {
        console.error("Failed to close MongoDB connection:", error);
    }
}




}
