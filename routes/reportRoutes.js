const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');

// Get dashboard stats
router.get('/dashboard', auth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todaySales = await Sale.find({ date: { $gte: today } });
    const todaySalesAmount = todaySales.reduce((sum, s) => sum + s.amountPaid, 0);
    
    const totalCustomers = await Customer.countDocuments();
    const totalProducts = await Product.countDocuments();
    const lowStockProducts = await Product.countDocuments({ quantity: { $lt: 10 } });
    
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthlySales = await Sale.find({ date: { $gte: startOfMonth } });
    const monthlySalesAmount = monthlySales.reduce((sum, s) => sum + s.amountPaid, 0);
    
    const monthlyPurchases = await Purchase.find({ date: { $gte: startOfMonth } });
    const monthlyPurchaseAmount = monthlyPurchases.reduce((sum, p) => sum + p.totalAmount, 0);
    
    const monthlyExpenses = await Expense.find({ date: { $gte: startOfMonth } });
    const monthlyExpenseAmount = monthlyExpenses.reduce((sum, e) => sum + e.amount, 0);
    
    const pendingSales = await Sale.find({ remainingBalance: { $gt: 0 } });
    const totalOutstanding = pendingSales.reduce((sum, s) => sum + s.remainingBalance, 0);
    
    res.json({
      todaySales: todaySalesAmount,
      totalCustomers,
      totalProducts,
      lowStockProducts,
      monthlySales: monthlySalesAmount,
      monthlyPurchases: monthlyPurchaseAmount,
      monthlyExpenses: monthlyExpenseAmount,
      monthlyProfit: monthlySalesAmount - monthlyPurchaseAmount - monthlyExpenseAmount,
      totalOutstanding,
      pendingInvoices: pendingSales.length
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get sales report
router.get('/sales', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const sales = await Sale.find(query).populate('customer', 'name phone').sort({ date: -1 });
    
    const totalSales = sales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalDiscount = sales.reduce((sum, s) => sum + (s.discount || 0), 0);
    const totalSubtotal = sales.reduce((sum, s) => sum + (s.subtotal || s.totalAmount + (s.discount || 0)), 0);
    const totalReceived = sales.reduce((sum, s) => sum + s.amountPaid, 0);
    
    // ✅ Calculate total cost using weighted average from sale items
    const totalCost = sales.reduce((sum, s) => {
      const costSum = s.items.reduce((itemSum, item) => itemSum + (item.costPrice * item.quantity), 0);
      return sum + costSum;
    }, 0);
    
    // ✅ Correct profit calculation using weighted average cost
    const totalProfit = totalSales - totalCost;
    
    const formattedSales = sales.map(sale => ({
      _id: sale._id,
      invoiceNo: sale.invoiceNo,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      subtotal: sale.subtotal || sale.totalAmount + (sale.discount || 0),
      discount: sale.discount || 0,
      totalAmount: sale.totalAmount,
      amountPaid: sale.amountPaid,
      remainingBalance: sale.remainingBalance,
      status: sale.status,
      date: sale.date,
      // ✅ Add cost and profit per invoice
      cost: sale.items.reduce((sum, item) => sum + (item.costPrice * item.quantity), 0),
      profit: sale.totalAmount - sale.items.reduce((sum, item) => sum + (item.costPrice * item.quantity), 0)
    }));
    
    res.json({
      sales: formattedSales,
      summary: {
        totalSales,
        totalDiscount,
        totalSubtotal,
        totalReceived,
        totalCost,
        totalProfit,
        profitMargin: totalSales > 0 ? (totalProfit / totalSales * 100).toFixed(2) : 0,
        invoiceCount: sales.length
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get profit & loss report - WITH WEIGHTED AVERAGE
router.get('/profit-loss', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    // Get all sales
    const sales = await Sale.find(query).populate('customer', 'name');
    
    let totalSalesRevenue = 0;
    let totalSubtotal = 0;
    let totalDiscount = 0;
    let totalCost = 0;
    
    const discountDetails = [];
    
    for (const sale of sales) {
      const saleAmount = sale.totalAmount;
      const discountAmount = sale.discount || 0;
      const subtotalAmount = sale.subtotal || saleAmount + discountAmount;
      
      totalSalesRevenue += saleAmount;
      totalSubtotal += subtotalAmount;
      totalDiscount += discountAmount;
      
      // ✅ Calculate cost using weighted average from sale items
      const costSum = sale.items.reduce((itemSum, item) => itemSum + (item.costPrice * item.quantity), 0);
      totalCost += costSum;
      
      if (discountAmount > 0) {
        discountDetails.push({
          invoiceNo: sale.invoiceNo,
          customerName: sale.customerName,
          subtotal: subtotalAmount,
          discount: discountAmount,
          totalAmount: saleAmount
        });
      }
    }
    
    // ✅ Correct: Gross Profit = Total Sales Revenue - Cost of Goods (using weighted average)
    const grossProfit = totalSalesRevenue - totalCost;
    
    // Expenses
    const expenses = await Expense.find(query);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    const byCategory = {};
    expenses.forEach(e => {
      if (!byCategory[e.category]) byCategory[e.category] = 0;
      byCategory[e.category] += e.amount;
    });
    
    const netProfit = grossProfit - totalExpenses;
    const profitMargin = totalSalesRevenue > 0 ? (netProfit / totalSalesRevenue * 100) : 0;
    
    const purchases = await Purchase.find(query);
    const totalPurchases = purchases.reduce((sum, p) => sum + p.totalAmount, 0);
    
    console.log("========== PROFIT & LOSS (Weighted Average) ==========");
    console.log(`Total Sales Revenue: PKR ${totalSalesRevenue}`);
    console.log(`Total Discount Given: PKR ${totalDiscount}`);
    console.log(`Total Cost of Goods (Weighted Avg): PKR ${totalCost}`);
    console.log(`Gross Profit: PKR ${grossProfit}`);
    console.log(`Total Expenses: PKR ${totalExpenses}`);
    console.log(`Net Profit: PKR ${netProfit}`);
    console.log(`Profit Margin: ${profitMargin.toFixed(2)}%`);
    console.log("=====================================================");
    
    res.json({
      period: { startDate, endDate },
      sales: { 
        total: totalSalesRevenue,
        subtotal: totalSubtotal,
        totalDiscount: totalDiscount,
        netSales: totalSalesRevenue,
        cost: totalCost, 
        grossProfit,
        discountDetails
      },
      expenses: { total: totalExpenses, byCategory },
      purchases: { total: totalPurchases },
      netProfit,
      profitMargin: parseFloat(profitMargin.toFixed(2))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get product-wise sales report
router.get('/product-wise', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = {};
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const sales = await Sale.find(query);
    
    const productSales = {};
    
    for (const sale of sales) {
      for (const item of sale.items) {
        const productId = item.product.toString();
        if (!productSales[productId]) {
          productSales[productId] = {
            product_id: productId,
            product_name: item.productName,
            total_quantity: 0,
            total_revenue: 0,
            total_cost: 0, // ✅ Add cost tracking
            transactions: 0
          };
        }
        
        productSales[productId].total_quantity += item.quantity;
        productSales[productId].total_revenue += item.total;
        productSales[productId].total_cost += (item.costPrice * item.quantity); // ✅ Weighted avg cost
        productSales[productId].transactions += 1;
      }
    }
    
    const report = Object.values(productSales);
    const totalRevenue = report.reduce((sum, r) => sum + r.total_revenue, 0);
    
    report.forEach(r => {
      r.percentage = totalRevenue > 0 ? (r.total_revenue / totalRevenue) * 100 : 0;
      r.average_price = r.total_quantity > 0 ? r.total_revenue / r.total_quantity : 0;
      r.average_cost = r.total_quantity > 0 ? r.total_cost / r.total_quantity : 0;
      r.total_profit = r.total_revenue - r.total_cost;
      r.profit_margin = r.total_revenue > 0 ? (r.total_profit / r.total_revenue) * 100 : 0;
    });
    
    report.sort((a, b) => b.total_revenue - a.total_revenue);
    
    res.json({
      summary: {
        total_products_sold: report.length,
        total_quantity: report.reduce((sum, r) => sum + r.total_quantity, 0),
        total_revenue: totalRevenue,
        total_cost: report.reduce((sum, r) => sum + r.total_cost, 0),
        total_profit: report.reduce((sum, r) => sum + r.total_profit, 0)
      },
      report,
      sales_count: sales.length
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get purchase report
router.get('/purchases', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const purchases = await Purchase.find(query).populate('product', 'name').sort({ date: -1 });
    const totalPurchases = purchases.reduce((sum, p) => sum + p.totalAmount, 0);
    
    res.json({
      purchases,
      summary: {
        totalPurchases,
        purchaseCount: purchases.length
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get expense report
router.get('/expenses', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const expenses = await Expense.find(query).sort({ date: -1 });
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    
    const byCategory = {};
    expenses.forEach(e => {
      if (!byCategory[e.category]) byCategory[e.category] = 0;
      byCategory[e.category] += e.amount;
    });
    
    res.json({
      expenses,
      summary: {
        totalExpenses,
        expenseCount: expenses.length,
        byCategory
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get customer dues report
router.get('/customer-dues', auth, async (req, res) => {
  try {
    const customersWithDues = await Sale.aggregate([
      { $match: { remainingBalance: { $gt: 0 } } },
      {
        $group: {
          _id: '$customer',
          customerName: { $first: '$customerName' },
          customerPhone: { $first: '$customerPhone' },
          totalDue: { $sum: '$remainingBalance' },
          invoices: { 
            $push: { 
              invoiceNo: '$invoiceNo', 
              amount: '$remainingBalance', 
              date: '$date',
              totalAmount: '$totalAmount',
              amountPaid: '$amountPaid'
            } 
          }
        }
      },
      { $sort: { totalDue: -1 } }
    ]);
    
    res.json(customersWithDues);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get stock summary report
router.get('/stock-summary', auth, async (req, res) => {
  try {
    const products = await Product.find().sort({ name: 1 });
    
    const totalStockValue = products.reduce((sum, p) => sum + (p.weightedAverageCost || p.currentCostPrice || 0) * p.quantity, 0);
    const totalSellingValue = products.reduce((sum, p) => sum + (p.currentSellingPrice || 0) * p.quantity, 0);
    const lowStockProducts = products.filter(p => p.quantity < 10);
    const outOfStock = products.filter(p => p.quantity === 0);
    
    res.json({
      products,
      summary: {
        totalProducts: products.length,
        totalStockValue,
        totalSellingValue,
        potentialProfit: totalSellingValue - totalStockValue,
        lowStockCount: lowStockProducts.length,
        outOfStockCount: outOfStock.length
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get monthly summary report
router.get('/monthly-summary', auth, async (req, res) => {
  try {
    const { year } = req.query;
    const targetYear = parseInt(year) || new Date().getFullYear();
    
    const monthlyData = [];
    
    for (let month = 0; month < 12; month++) {
      const startDate = new Date(targetYear, month, 1);
      const endDate = new Date(targetYear, month + 1, 0);
      
      const sales = await Sale.find({
        date: { $gte: startDate, $lte: endDate }
      });
      
      const purchases = await Purchase.find({
        date: { $gte: startDate, $lte: endDate }
      });
      
      const expenses = await Expense.find({
        date: { $gte: startDate, $lte: endDate }
      });
      
      const totalSales = sales.reduce((sum, s) => sum + s.amountPaid, 0);
      const totalPurchases = purchases.reduce((sum, p) => sum + p.totalAmount, 0);
      const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
      
      // ✅ Calculate cost using weighted average
      const totalCost = sales.reduce((sum, s) => {
        const costSum = s.items.reduce((itemSum, item) => itemSum + (item.costPrice * item.quantity), 0);
        return sum + costSum;
      }, 0);
      
      const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
      const grossProfit = totalRevenue - totalCost;
      const netProfit = grossProfit - totalExpenses;
      
      monthlyData.push({
        month: new Date(targetYear, month).toLocaleString('default', { month: 'short' }),
        year: targetYear,
        sales: totalRevenue,
        cost: totalCost,
        purchases: totalPurchases,
        expenses: totalExpenses,
        grossProfit: grossProfit,
        profit: netProfit,
        profitMargin: totalRevenue > 0 ? (netProfit / totalRevenue * 100) : 0
      });
    }
    
    res.json(monthlyData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get top selling products report
router.get('/top-products', auth, async (req, res) => {
  try {
    const { limit = 10, startDate, endDate } = req.query;
    
    let query = {};
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    const sales = await Sale.find(query);
    
    const productSales = {};
    
    for (const sale of sales) {
      for (const item of sale.items) {
        const productId = item.product.toString();
        if (!productSales[productId]) {
          productSales[productId] = {
            product_id: productId,
            product_name: item.productName,
            total_quantity: 0,
            total_revenue: 0,
            total_cost: 0
          };
        }
        
        productSales[productId].total_quantity += item.quantity;
        productSales[productId].total_revenue += item.total;
        productSales[productId].total_cost += (item.costPrice * item.quantity);
      }
    }
    
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, parseInt(limit));
    
    // Add profit margin
    topProducts.forEach(p => {
      p.total_profit = p.total_revenue - p.total_cost;
      p.profit_margin = p.total_revenue > 0 ? (p.total_profit / p.total_revenue * 100) : 0;
    });
    
    res.json(topProducts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;