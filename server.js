const express=require("express");
const app=express();
app.use(express.json());
app.use(express.static("."));
app.post("/search",(req,res)=>res.json({ok:true}));
app.listen(process.env.PORT||8080);
