import { Navigate, Outlet, useOutletContext } from 'react-router';
import type { AppOutletContext } from '../types';

export default function Outer () {
    const outletContext = useOutletContext<AppOutletContext>();
    const { loginInfo } = outletContext;

    if (!loginInfo.login) {
        return <Navigate to={"/login"} />
    }

    return <Outlet context={outletContext} />
}
