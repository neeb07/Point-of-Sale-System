const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../pos_database.db');
const db = new Database(DB_PATH);

db.exec(`
  DELETE FROM menu_items;
`);

const insert = db.prepare('INSERT INTO menu_items (name, category, price) VALUES (?, ?, ?)');

const seedItems = [
  // STARTERS
  ['Crispy Wings', 'Starters', 400],
  ['Baked Wings', 'Starters', 400],
  ['Spicy Wings', 'Starters', 450],
  ['Honey Wings', 'Starters', 450],
  ['B.B.Q Wings', 'Starters', 450],
  ['Nuggets', 'Starters', 300],
  ['Fried Chicken Pieces', 'Starters', 650],

  // FRIES
  ['Regular Fries', 'Fries', 280],
  ['Large Fries', 'Fries', 380],
  ['Family Fries', 'Fries', 480],
  ['Garlic Mayo Fries', 'Fries', 400],
  ['Cheesy Mayo Fries', 'Fries', 500],
  ['Pizza Fries', 'Fries', 500],

  // WRAPS & ROLLS
  ['Lebanese Chk Shawarma', 'Wraps & Rolls', 250],
  ['Zinger Shawarma', 'Wraps & Rolls', 350],
  ['Arabic Chk Wrap', 'Wraps & Rolls', 350],
  ['Arabic Beef Wrap', 'Wraps & Rolls', 400],
  ['Chk Tikka Wrap (Spicy)', 'Wraps & Rolls', 350],
  ['Twister Sausage Wrap', 'Wraps & Rolls', 450],
  ['Mexican Chk Wrap (Spicy)', 'Wraps & Rolls', 450],
  ['Mexican Beef Wrap (Spicy)', 'Wraps & Rolls', 500],

  // SANDWICHES + HOTDOGS
  ['Toasted Tikka Sandwich', 'Sandwiches + Hotdogs', 550],
  ['Toasted Chk Smoke Sandwich', 'Sandwiches + Hotdogs', 550],
  ['Toasted Beef Sandwich', 'Sandwiches + Hotdogs', 600],
  ['Mexican Chk Sandwich', 'Sandwiches + Hotdogs', 550],
  ['Grilled Chk Sandwich', 'Sandwiches + Hotdogs', 700],
  ['Crunchy Chk Sandwich', 'Sandwiches + Hotdogs', 700],
  ['Classic Hotdog', 'Sandwiches + Hotdogs', 350],
  ['Seattle Hotdog', 'Sandwiches + Hotdogs', 450],

  // BURGERS
  ['Chicken Burger', 'Burgers', 300],
  ['Zinger Burger', 'Burgers', 380],
  ['Double Decker Zinger Burger', 'Burgers', 650],
  ['Tower Zinger Burger', 'Burgers', 600],
  ['Chk Fillet Steak Burger', 'Burgers', 450],
  ['Tower Chk Fillet Steak Burger', 'Burgers', 600],
  ['Jalapeno Chk Fillet Steak Burger', 'Burgers', 440],
  ['Chk Fillet Mushroom Burger', 'Burgers', 500],
  ['Double Decker Chk Fillet Burger', 'Burgers', 600],
  ['Beef Burger', 'Burgers', 400],
  ['Jalapeno Beef Burger', 'Burgers', 450],
  ['Swiss Mushroom Beef Burger', 'Burgers', 500],
  ['Classic Beef & Steak Burger', 'Burgers', 600],
  ['Beef Double Stack Burger', 'Burgers', 550],
  ['Italian Stuffed Burger', 'Burgers', 500],
  ['Italian Mushroom Sauce Burger', 'Burgers', 550],

  // PARATHA/SPIN ROLLS
  ['Chk Tikka Paratha Roll', 'Paratha/Spin Rolls', 240],
  ['Chk Malai Paratha Roll', 'Paratha/Spin Rolls', 240],
  ['Chk Kabab Paratha Roll', 'Paratha/Spin Rolls', 240],
  ['Beef Kabab Paratha Roll', 'Paratha/Spin Rolls', 250],
  ['Malai Boti Spin Roll', 'Paratha/Spin Rolls', 300],
  ['Chk Tikka Boti Spin Roll', 'Paratha/Spin Rolls', 300],
  ['Kabab Spin Roll', 'Paratha/Spin Rolls', 350],

  // SPECIALITIES
  ['Chicken Ala Kiev', 'Specialities', 750],
  ['Mac & Cheese', 'Specialities', 700],
  ['Italian Chicken Lasagna', 'Specialities', 950],
  ['Chicken Mushroom Alfredo', 'Specialities', 750],

  // TRADITIONAL PIZZAS
  ['Veggie Pizza', 'Traditional Pizzas', 550],
  ['Fajita Pizza', 'Traditional Pizzas', 550],
  ['Tikka Pizza', 'Traditional Pizzas', 550],
  ['BBQ Pizza', 'Traditional Pizzas', 550],
  ['Sausage & Mushroom Pizza', 'Traditional Pizzas', 550],
  ['Pepperoni Pizza', 'Traditional Pizzas', 550],
  ['Hot & Spicy Pizza', 'Traditional Pizzas', 550],
  ['Beef Supreme Pizza', 'Traditional Pizzas', 550],
  ['Chicken Supreme Pizza', 'Traditional Pizzas', 550],
  ['Cheese Lover Pizza', 'Traditional Pizzas', 550],

  // SPECIAL PIZZAS
  ['Alfredo Pizza', 'Special Pizzas', 600],
  ['Behari Kebab Pizza', 'Special Pizzas', 600],
  ['Malai Boti Pizza', 'Special Pizzas', 600],

  // LARGE CRUST FILLED PIZZA
  ['Large Crust Filled Pizza', 'Large Crust Filled Pizza', 2150],

  // NEW YORK CALZONE
  ['New York Calzone', 'New York Calzone', 750],

  // GRAVIES
  ['Manchurian Sizzling', 'Gravies', 750],
  ['Shashlik Sizzling', 'Gravies', 750],
  ['Garlic Chicken', 'Gravies', 750],
  ['Black Pepper Chicken', 'Gravies', 800],
  ['Chicken Jalfarezi', 'Gravies', 800],
  ['Chicken Chilli Dry', 'Gravies', 850],
  ['Beef Chilli Dry', 'Gravies', 900],

  // GRAVIES WITH RICE
  ['Manchurian With Rice', 'Gravies With Rice', 850],
  ['Shashlik With Rice', 'Gravies With Rice', 850],
  ['Chicken Garlic With Rice', 'Gravies With Rice', 850],
  ['Black Pepper With Rice', 'Gravies With Rice', 850],
  ['Chk Jalfarezi With Rice', 'Gravies With Rice', 900],
  ['Chk Chilli Dry With Rice', 'Gravies With Rice', 950],
  ['Beef Chilli Dry With Rice', 'Gravies With Rice', 1000],

  // FRIED RICE/BIRYANI
  ['Chicken Fried Rice', 'Fried Rice/Biryani', 450],
  ['Beef Chilli Fried Rice', 'Fried Rice/Biryani', 500],
  ['Special Fried Rice', 'Fried Rice/Biryani', 600],
  ['Mughlai Chk Biryani', 'Fried Rice/Biryani', 500],

  // CHOWMEIN
  ['Chicken Chowmein', 'Chowmein', 750],
  ['Beef Chowmein', 'Chowmein', 800],

  // SOUPS
  ['Hot & Sour Soup', 'Soups', 350],
  ['Chk Corn Soup', 'Soups', 300],
  ['Tasty Special Soup', 'Soups', 400],

  // STEAKS
  ['American Chk Steak', 'Steaks', 950],
  ['Mushroom Chk Steak', 'Steaks', 950],
  ['Mexican Chk Steak', 'Steaks', 950],

  // BBQ
  ['Malai Reshmi Boti', 'BBQ', 450],
  ['Chicken Tikka Boti', 'BBQ', 400],
  ['Chicken Tikka (Leg)', 'BBQ', 350],
  ['Chicken Tikka (Chest)', 'BBQ', 370],
  ['Chicken Reshmi Kabab', 'BBQ', 450],
  ['Beef Seekh Kabab', 'BBQ', 400],

  // PAKISTAN/DESI
  ['Chk Handi', 'Pakistan/Desi', 800],
  ['Chk Makhni Handi', 'Pakistan/Desi', 800],
  ['Chk White Handi', 'Pakistan/Desi', 850],
  ['Chk Achari Handi', 'Pakistan/Desi', 850],
  ['Chk Tikka (Masala Handi)', 'Pakistan/Desi', 850],
  ['Chk Paneer (Reshmi Handi)', 'Pakistan/Desi', 900],
  ['Chk Lahori Karahi', 'Pakistan/Desi', 750],
  ['Chk Shinwari Karahi', 'Pakistan/Desi', 750],
  ['Chk White Karahi', 'Pakistan/Desi', 800],
  ['Chk Achari Karahi', 'Pakistan/Desi', 800],
  ['Chk Green Karahi', 'Pakistan/Desi', 850],
  ['Seekh Kabab Karahi', 'Pakistan/Desi', 750],

  // SALADS/RAITA
  ['Fresh Salad', 'Salads/Raita', 100],
  ['Mint Raita', 'Salads/Raita', 120],

  // BEVERAGES
  ['Water Small', 'Beverages', 70],
  ['Water 1.5 L', 'Beverages', 100],
  ['Can 500 ML', 'Beverages', 110],
  ['Soft Drink 1.5 L', 'Beverages', 220],
  ['Soft Drink 1 L', 'Beverages', 180],
  ['Soft Drink 350 ML', 'Beverages', 90],

  // ROTI/NAAN
  ['Sada Naan', 'Roti/Naan', 50],
  ['Roghni Naan', 'Roti/Naan', 60],
  ['Roti', 'Roti/Naan', 20],
  ['Garlic Naan', 'Roti/Naan', 100],
  ['Qeema Naan', 'Roti/Naan', 250],
  ['Cheese Naan', 'Roti/Naan', 300],
];

// Execute insertion within a transaction for safety and speed
const insertMany = db.transaction((items) => {
  for (const item of items) {
    insert.run(item[0], item[1], item[2]);
  }
});

insertMany(seedItems);

console.log('Successfully seeded ' + seedItems.length + ' menu items.');
