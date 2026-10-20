/* global jest */
import 'react-native-gesture-handler/jestSetup'

import {configure} from '@testing-library/react-native'

configure({asyncUtilTimeout: 20000})

jest.mock('crypto', () => ({}))
