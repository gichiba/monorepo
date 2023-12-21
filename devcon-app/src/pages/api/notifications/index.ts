import { NextApiRequest, NextApiResponse } from 'next'
import { withSessionRoute } from "server/withIronSession"
import webPush from 'web-push';

// const repo = new UserAccountRepository()

export default withSessionRoute(async function route(req: NextApiRequest, res: NextApiResponse) {
    const { id } = req.query
    
    if (req.method === 'PUT') {
        return put(req, res)
    }

    if (req.method === 'DELETE') {
        return del(req, res)
    }

    if (req.method === 'POST') {
        return post(req, res);
    }

    return get(req, res);
})

webPush.setVapidDetails(
    'mailto:devcon-website@ethereum.org',
    process.env.VAPID_PUBLIC as string,
    process.env.VAPID_PRIVATE as string
);

const subscriptions = [] as any;

export const post = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.body) {
        subscriptions.push(JSON.parse(req.body));
    }

    return res.status(200).send({ code: 200, message: req.body.subscription })
}

export const get = async (req: NextApiRequest, res: NextApiResponse) => {
    subscriptions.forEach((subscription: any) => {
        webPush.sendNotification(subscription, 'hello from server!');
    })

    return res.status(200).send({ code: 200, message: process.env.VAPID_PUBLIC })
}

async function put(req: NextApiRequest, res: NextApiResponse) {

}

async function del(req: NextApiRequest, res: NextApiResponse) {

}
