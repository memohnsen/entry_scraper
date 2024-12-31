const { scrapeWeightliftingData } = require('./scraper');

async function main() {
    try {
        const entries = await scrapeWeightliftingData();
        console.log('Scraping completed successfully!');
    } catch (error) {
        console.error('Scraping failed:', error);
    }
}

main(); 