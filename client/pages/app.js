const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));
app.post('/upload', (req, res) => {
const images = req.body.images;
images.forEach((img, index) => {
const base64Data = img.replace(/^data:image\/png;base64,/, "");
fs.writeFileSync(`uploads/image_${Date.now()}_${index}.png`, base64Data,
'base64');
});
res.send("Saved");
});
app.listen(3000, () => console.log(`App running at http://localhost:3000`));