import https from 'https';
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient, PutItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";

const secretsManager = new SecretsManagerClient({
region: "us-east-1",
}); 

const dynamoDBClient = new DynamoDBClient({
    region: "us-east-1",
});

export const handler = async (event) => {
    try {
        console.log("Received input: ", event);

        const { longitude, latitude, timestamp, unit, action } = event;

        // Check if weather data is cached in DynamoDB
        const cachedWeatherData = await getCachedWeatherData(longitude, latitude, timestamp);
        if (cachedWeatherData) {
            console.log("Cached weather data found");
            return { weatherData: cachedWeatherData }; // Wrap cached data in an object
        }

        // Retrieve API key from Secrets Manager
        const secretName = process.env.OpenWeatherApiKeySecretName; 
        const response = await secretsManager.send(
            new GetSecretValueCommand({
                SecretId: secretName,
                VersionStage: "AWSCURRENT",
            })
        );

        // Construct the API URL dynamically
        const openWeatherAPIURL = "https://api.openweathermap.org/data/2.5/onecall/timemachine?lat=" + latitude + "&lon=" + longitude + "&dt=" + timestamp + "&units=" + unit + "&appid=" + response.SecretString;
        console.log("openWeatherAPIURL: ", openWeatherAPIURL);

        // Make API call to OpenWeather
        const weatherData = await fetchData(openWeatherAPIURL);

        console.log("weatherData Fetched from API: ", weatherData);
        
        // Cache weather data in DynamoDB
        await cacheWeatherData(longitude, latitude, timestamp, weatherData);

        return { weatherData }; // Wrap fetched data in an object
    } catch (error) {
        console.error("Error occurred: ", error);
        throw error;
    }
};

async function fetchData(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve(JSON.parse(data));
            });

        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function getCachedWeatherData(longitude, latitude, timestamp) {
    const params = {
        TableName: process.env.CFDynamoDBWeatherTableName,
        Key: {
            "location": { S: longitude.toString() + ',' + latitude.toString() + ',' + timestamp.toString() }
        }
    };

    try {
        const data = await dynamoDBClient.send(new GetItemCommand(params));
        return data.Item ? JSON.parse(data.Item.weatherData.S) : null;
    } catch (error) {
        console.error("Error fetching cached data from DynamoDB: ", error);
        return null;
    }
}

async function cacheWeatherData(longitude, latitude, timestamp, weatherData) {
    const params = {
        TableName: process.env.CFDynamoDBWeatherTableName, 
        Item: {
            "location": { S: longitude.toString() + ',' + latitude.toString() + ',' + timestamp.toString() },
            "weatherData": { S: JSON.stringify(weatherData) }
        }
    };

    try {
        await dynamoDBClient.send(new PutItemCommand(params));
        console.log("Weather data cached successfully");
    } catch (error) {
        console.error("Error caching data in DynamoDB: ", error);
    }
}