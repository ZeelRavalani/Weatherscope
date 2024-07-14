import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import https from 'https';

const snsClient = new SNSClient({
region: "us-east-1" 
});

const secretsManager = new SecretsManagerClient({
region: "us-east-1"  
});

export const handler = async (event) => {
    try {
        console.log("Received input: ", event);

        // Retrieve Google Maps API key from Secrets Manager
        const googleMapsSecretName = process.env.GoogleMapsApiKeySecretName;
        const googleMapsResponse = await secretsManager.send(
            new GetSecretValueCommand({
                SecretId: googleMapsSecretName,
                VersionStage: "AWSCURRENT"
            })
        );
        const googleMapsApiKey = googleMapsResponse.SecretString.replace(/[{()}]/g, '');

        // Parse input event
        const { longitude, latitude, timestamp, unit, action } = event;
        const cityCountry = await getCityCountry(longitude, latitude, googleMapsApiKey);
        let message;

        // Customize message based on action
        if (action === "current") {
            message = ` Weatherscope API triggered for `+ action + `weather in ` + cityCountry;
        } else if (action === "timestamp") {
            const dateAndTime = timestamp ? formatDate(new Date(parseInt(timestamp) * 1000)) : "unknown date and time";
            message = ' Weatherscope API triggered for weather at ' + dateAndTime + ' in ' + cityCountry;
        } else {
            message = " Invalid action specified";
        }

        const topicArn = process.env.CFWeatherSnsTopicArn;
        const params = {
            TopicArn: topicArn,
            Message: message
        };

        await snsClient.send(new PublishCommand(params));

        console.log("SNS notification sent successfully");
        return event;
    } catch (error) {
        console.error("Error occurred: ", error);
        throw error;
    }
}

async function getCityCountry(longitude, latitude, apiKey) {
    return new Promise((resolve, reject) => {
        const url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + latitude + ',' + longitude + '&key=' + apiKey;
        console.log("url: " + url);

        https.get(url, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                const response = JSON.parse(data);
                if (response.status === 'OK' && response.results.length > 0) {
                    const addressComponents = response.results[0].address_components;
                    const city = addressComponents.find(component => component.types.includes('locality'));
                    const country = addressComponents.find(component => component.types.includes('country'));
                    let cityCountry;
                    if (city && country) {
                        cityCountry = city.long_name + ', ' + country.long_name;
                    } else {
                        cityCountry = 'Unknown City, Unknown Country';
                    }
                    resolve(cityCountry);
                } else {
                    reject(new Error('Unable to fetch city and country'));
                }
            });

        }).on('error', (err) => {
            reject(err);
        });
    });
}

function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return day + '/' + month + '/' + year + ' ' + hours + ':' + minutes + ':' + seconds;
}