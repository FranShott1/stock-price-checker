'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');

// Connect to MongoDB
mongoose.connect(process.env.DB || process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Define Stock Schema
const stockSchema = new mongoose.Schema({
  symbol: { type: String, required: true, uppercase: true },
  likes: [String] // Array of hashed IPs
});

const Stock = mongoose.model('Stock', stockSchema);

// Function to hash IP address for privacy
function hashIP(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

// Function to get stock data from the proxy API
async function getStockData(symbol) {
  try {
    const response = await axios.get(
      `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${symbol}/quote`
    );
    return response.data;
  } catch (error) {
    return null;
  }
}

// Function to get or create stock in database
async function getOrCreateStock(symbol, ipHash, like) {
  let stock = await Stock.findOne({ symbol: symbol.toUpperCase() });
  
  if (!stock) {
    stock = new Stock({
      symbol: symbol.toUpperCase(),
      likes: like ? [ipHash] : []
    });
    await stock.save();
  } else if (like && !stock.likes.includes(ipHash)) {
    stock.likes.push(ipHash);
    await stock.save();
  }
  
  return stock;
}

module.exports = function (app) {

  app.route('/api/stock-prices')
    .get(async function (req, res) {
      try {
        const { stock, like } = req.query;
        
        if (!stock) {
          return res.json({ error: 'stock parameter required' });
        }

        // Get client IP and hash it
        const ip = req.ip || req.connection.remoteAddress;
        const ipHash = hashIP(ip);
        
        // Convert like to boolean
        const likeStock = like === 'true' || like === true;

        // Check if multiple stocks requested
        if (Array.isArray(stock)) {
          // Handle two stocks
          const stock1Symbol = stock[0];
          const stock2Symbol = stock[1];

          // Get stock data from API
          const [stockData1, stockData2] = await Promise.all([
            getStockData(stock1Symbol),
            getStockData(stock2Symbol)
          ]);

          if (!stockData1 || !stockData2) {
            return res.json({ error: 'invalid stock symbol' });
          }

          // Get or create stocks in database
          const [dbStock1, dbStock2] = await Promise.all([
            getOrCreateStock(stock1Symbol, ipHash, likeStock),
            getOrCreateStock(stock2Symbol, ipHash, likeStock)
          ]);

          // Calculate relative likes
          const likes1 = dbStock1.likes.length;
          const likes2 = dbStock2.likes.length;

          return res.json({
            stockData: [
              {
                stock: stockData1.symbol,
                price: stockData1.latestPrice,
                rel_likes: likes1 - likes2
              },
              {
                stock: stockData2.symbol,
                price: stockData2.latestPrice,
                rel_likes: likes2 - likes1
              }
            ]
          });

        } else {
          // Handle single stock
          const stockSymbol = stock;

          // Get stock data from API
          const stockData = await getStockData(stockSymbol);

          if (!stockData) {
            return res.json({ error: 'invalid stock symbol' });
          }

          // Get or create stock in database
          const dbStock = await getOrCreateStock(stockSymbol, ipHash, likeStock);

          return res.json({
            stockData: {
              stock: stockData.symbol,
              price: stockData.latestPrice,
              likes: dbStock.likes.length
            }
          });
        }

      } catch (error) {
        console.error('Error:', error);
        res.json({ error: 'server error' });
      }
    });
    
};
