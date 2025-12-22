const express=require("express");
const fetch=require("node-fetch");
const app=express();
app.use(express.static("."));
app.post("/search", async (req,res)=>{
  const r=await fetch("https://europe-west1-gen-lang-client-0651826784.cloudfunctions.net/search",{method:"POST"});
  res.send(await r.text());
});
app.listen(process.env.PORT||8080);
