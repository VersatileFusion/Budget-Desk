require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Connection error:', err);
    process.exit(1);
  });