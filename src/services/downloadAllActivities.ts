import dotenv from 'dotenv';
dotenv.config();

const headers = {
    'Authorization': `Bearer ${process.env.API_TOKEN}`,
    'Content-Type': 'application/json'
};

export default function downloadAllActivities() {
    
    fetch(`https://api.kickbase.com/v4/leagues/5378755/activitiesFeed?max=26&start=0`, {
        headers: headers
    })
    .then(response => response.json())
    .then(data => {
        console.log(JSON.stringify(data, null, 2));
    })
    .catch(error => {
        console.error('Error fetching activities:', error);
    });

}